#!/usr/bin/env python3
"""
scripts/transcribe_audio.py
音频转 MIDI (Audio-to-MIDI) 离线转录工具

用途：
  将任意 MP3 / WAV / M4A / FLAC 音频文件中的主旋律提取为标准 MIDI 文件 (.mid)。
  转录出的 MIDI 文件可直接供螺线谱 (Spiral Notation) 播放与可视化。

策略：
  1. 若已安装 basic-pitch (Spotify 深度学习转谱)，优先启用高精度神经网络扒带；
  2. 若未安装，自动回退到内置的 YIN 算法 + 瞬态能量切片，使用 ffmpeg + numpy 实现零重度依赖转谱；
  3. 支持指定输出路径与音高门限。

用法：
  python3 scripts/transcribe_audio.py input.mp3 -o samples/kunlun_lead.mid
"""

import sys
import os
import argparse
import subprocess
import struct
import math

def check_basic_pitch():
    try:
        import basic_pitch
        return True
    except ImportError:
        return False

def transcribe_with_basic_pitch(audio_path, output_midi_path):
    print(f"[*] 启用 Spotify Basic Pitch 神经网络进行高精度转录: {audio_path}")
    from basic_pitch.inference import predict_and_save
    output_dir = os.path.dirname(os.path.abspath(output_midi_path)) or '.'
    os.makedirs(output_dir, exist_ok=True)
    
    # basic_pitch predict_and_save 会自动生成 <basename>_basic_pitch.mid
    predict_and_save(
        audio_path_list=[audio_path],
        output_directory=output_dir,
        save_midi=True,
        sonify_midi=False,
        save_model_outputs=False,
        save_notes=False
    )
    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    generated_midi = os.path.join(output_dir, f"{base_name}_basic_pitch.mid")
    if os.path.exists(generated_midi) and generated_midi != output_midi_path:
        os.replace(generated_midi, output_midi_path)
    print(f"[✓] Basic Pitch 转录完成: {output_midi_path}")

def read_audio_with_ffmpeg(audio_path, sample_rate=22050):
    """利用 ffmpeg 将任意格式音频解码为 16-bit 单声道 PCM 数据"""
    cmd = [
        "ffmpeg", "-nostdin", "-v", "error", "-i", audio_path,
        "-ac", "1", "-ar", str(sample_rate), "-f", "s16le", "-"
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    raw_data, err = proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg 解码失败: {err.decode('utf-8', errors='ignore')}")
    
    import numpy as np
    samples = np.frombuffer(raw_data, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, sample_rate

def yin_pitch_detect(signal, sample_rate, frame_size=2048, hop_size=512, threshold=0.15):
    """使用 YIN 算法进行基频时序提取"""
    import numpy as np
    
    half_frame = frame_size // 2
    total_frames = (len(signal) - frame_size) // hop_size
    pitches = []
    
    for f in range(total_frames):
        start = f * hop_size
        frame = signal[start : start + frame_size]
        time = start / sample_rate
        
        # 能量检测
        rms = np.sqrt(np.mean(frame ** 2))
        if rms < 0.015:
            pitches.append((time, None, 0.0))
            continue
            
        # 1. 差分函数
        diff = np.zeros(half_frame, dtype=np.float32)
        for tau in range(half_frame):
            delta = frame[:half_frame] - frame[tau : tau + half_frame]
            diff[tau] = np.sum(delta ** 2)
            
        # 2. 累积均值归一化 (CMNDF)
        cmndf = np.zeros(half_frame, dtype=np.float32)
        cmndf[0] = 1.0
        running_sum = 0.0
        for tau in range(1, half_frame):
            running_sum += diff[tau]
            cmndf[tau] = (diff[tau] * tau) / (running_sum + 1e-9)
            
        # 3. 寻找低于阈值的第一个谷底
        tau_chosen = -1
        for tau in range(2, half_frame):
            if cmndf[tau] < threshold:
                while tau + 1 < half_frame and cmndf[tau + 1] < cmndf[tau]:
                    tau += 1
                tau_chosen = tau
                break
                
        if tau_chosen == -1:
            # 容错搜索全局较优谷底
            min_tau = np.argmin(cmndf[2:]) + 2
            if cmndf[min_tau] < 0.35:
                tau_chosen = min_tau
            else:
                pitches.append((time, None, 0.0))
                continue
                
        # 4. 抛物线插值
        if 0 < tau_chosen < half_frame - 1:
            s0 = cmndf[tau_chosen - 1]
            s1 = cmndf[tau_chosen]
            s2 = cmndf[tau_chosen + 1]
            bottom = 2 * (2 * s1 - s2 - s0)
            if abs(bottom) > 1e-6:
                tau_chosen = tau_chosen + (s2 - s0) / bottom
                
        freq = sample_rate / tau_chosen
        if 32.0 <= freq <= 4000.0:
            midi_val = 69.0 + 12.0 * math.log2(freq / 440.0)
            pitches.append((time, round(midi_val), float(rms)))
        else:
            pitches.append((time, None, 0.0))
            
    return pitches

def segment_into_notes(pitches, min_duration=0.08):
    """将逐帧音高序列聚类切片为分立音符"""
    notes = []
    current_note = None
    
    for time, midi, rms in pitches:
        if midi is not None:
            if current_note is None:
                current_note = {'midi': midi, 'start': time, 'end': time, 'rms_sum': rms, 'count': 1}
            elif midi == current_note['midi']:
                current_note['end'] = time
                current_note['rms_sum'] += rms
                current_note['count'] += 1
            else:
                dur = current_note['end'] - current_note['start']
                if dur >= min_duration:
                    vel = min(127, max(40, int((current_note['rms_sum'] / current_note['count']) * 127 * 6)))
                    notes.append((current_note['midi'], current_note['start'], dur, vel))
                current_note = {'midi': midi, 'start': time, 'end': time, 'rms_sum': rms, 'count': 1}
        else:
            if current_note is not None:
                dur = current_note['end'] - current_note['start']
                if dur >= min_duration:
                    vel = min(127, max(40, int((current_note['rms_sum'] / current_note['count']) * 127 * 6)))
                    notes.append((current_note['midi'], current_note['start'], dur, vel))
                current_note = None
                
    if current_note is not None:
        dur = current_note['end'] - current_note['start']
        if dur >= min_duration:
            vel = min(127, max(40, int((current_note['rms_sum'] / current_note['count']) * 127 * 6)))
            notes.append((current_note['midi'], current_note['start'], dur, vel))
            
    return notes

def write_standard_midi(notes, output_path, tempo_bpm=120):
    """纯 Python 二进制编码输出标准 MIDI 文件 (Format 0)，无需 mido 或外部 C 库依赖"""
    ticks_per_beat = 480
    seconds_per_tick = (60.0 / tempo_bpm) / ticks_per_beat
    
    events = []
    for midi, start, duration, vel in notes:
        start_tick = int(start / seconds_per_tick)
        end_tick = int((start + duration) / seconds_per_tick)
        events.append((start_tick, 0x90, midi, vel)) # Note On
        events.append((end_tick, 0x80, midi, 0))    # Note Off
        
    events.sort(key=lambda x: (x[0], 0 if x[1] == 0x80 else 1))
    
    track_bytes = bytearray()
    
    # 写入 Track Name
    name = b"Transcribed Lead"
    track_bytes.extend([0x00, 0xFF, 0x03, len(name)])
    track_bytes.extend(name)
    
    # 写入 Set Tempo (120 BPM -> 500,000 microseconds per beat)
    mpqn = int(60_000_000 / tempo_bpm)
    track_bytes.extend([0x00, 0xFF, 0x51, 0x03, (mpqn >> 16) & 0xFF, (mpqn >> 8) & 0xFF, mpqn & 0xFF])
    
    last_tick = 0
    for tick, status, note, vel in events:
        delta = max(0, tick - last_tick)
        last_tick = tick
        
        # 变长数量值 (Variable-Length Quantity) 编码
        buf = []
        val = delta
        buf.append(val & 0x7F)
        val >>= 7
        while val > 0:
            buf.append((val & 0x7F) | 0x80)
            val >>= 7
        buf.reverse()
        track_bytes.extend(buf)
        
        # 事件数据
        track_bytes.extend([status, note & 0x7F, vel & 0x7F])
        
    # End of Track
    track_bytes.extend([0x00, 0xFF, 0x2F, 0x00])
    
    # 构建 Header Chunk
    header = bytearray(b"MThd")
    header.extend(struct.pack(">IHHH", 6, 0, 1, ticks_per_beat))
    
    # 构建 Track Chunk
    track_chunk = bytearray(b"MTrk")
    track_chunk.extend(struct.pack(">I", len(track_bytes)))
    track_chunk.extend(track_bytes)
    
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or '.', exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(header)
        f.write(track_chunk)
        
    print(f"[✓] 标准 MIDI 文件生成成功: {output_path} (共 {len(notes)} 个音符)")

def main():
    parser = argparse.ArgumentParser(description="音频转 MIDI (Audio-to-MIDI) 离线转录工具")
    parser.add_argument("input", help="输入音频文件 (mp3, wav, m4a, flac, ogg 等)")
    parser.add_argument("-o", "--output", help="输出 MIDI 文件路径 (.mid)", default=None)
    parser.add_argument("--force-yin", action="store_true", help="强制使用 YIN 算法，不调用 basic-pitch")
    args = parser.parse_args()
    
    input_file = args.input
    if not os.path.exists(input_file):
        print(f"[!] 找不到输入音频文件: {input_file}", file=sys.stderr)
        sys.exit(1)
        
    if not args.output:
        base, _ = os.path.splitext(input_file)
        output_file = f"{base}.mid"
    else:
        output_file = args.output
        
    if not args.force_yin and check_basic_pitch():
        transcribe_with_basic_pitch(input_file, output_file)
    else:
        print(f"[*] 使用内置 YIN 信号处理流水线解析音频: {input_file}")
        signal, sr = read_audio_with_ffmpeg(input_file)
        pitches = yin_pitch_detect(signal, sr)
        notes = segment_into_notes(pitches)
        write_standard_midi(notes, output_file)

if __name__ == "__main__":
    main()
