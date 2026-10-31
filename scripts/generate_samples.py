#!/usr/bin/env python3
"""
Generate sample MIDI files for Spiral Notation demo.
"""
import os
import struct

def vlq(n):
    res = bytearray()
    while True:
        res.append((n & 0x7F) | (0x80 if res else 0x00))
        n >>= 7
        if n == 0:
            break
    res.reverse()
    return bytes(res)

def make_midi(notes, tempo_bpm=120, tpq=480):
    events = []
    us_per_qn = int(60000000 / tempo_bpm)
    tempo_bytes = bytes([0xFF, 0x51, 0x03, (us_per_qn >> 16) & 0xFF, (us_per_qn >> 8) & 0xFF, us_per_qn & 0xFF])
    events.append((0, 0, tempo_bytes))
    
    # Priority: note-off (0) before note-on (1) at the same tick
    for start, dur, pitch, vel in notes:
        events.append((start, 1, bytes([0x90, pitch, vel])))
        events.append((start + dur, 0, bytes([0x80, pitch, 0])))
        
    events.sort(key=lambda x: (x[0], x[1]))
    
    trk = bytearray()
    last_tick = 0
    for tick, _, evt in events:
        delta = tick - last_tick
        last_tick = tick
        trk.extend(vlq(delta))
        trk.extend(evt)
        
    trk.extend(vlq(0))
    trk.extend(b'\xFF\x2F\x00')
    
    hdr = struct.pack('>4sIHHH', b'MThd', 6, 0, 1, tpq)
    trk_chunk = struct.pack('>4sI', b'MTrk', len(trk)) + bytes(trk)
    return hdr + trk_chunk

def gen_canon_in_d():
    # Pachelbel's Canon in D (三声部复调卡农)
    tpq = 480
    qn = tpq        # 4分音符
    hn = qn * 2     # 2分音符
    en = qn // 2    # 8分音符
    sn = qn // 4    # 16分音符
    
    cycle_dur = hn * 8 # 8个和弦，每和弦2拍 = 16拍一轮
    notes = []
    
    # 1. 经典通奏低音 (Basso Continuo): D3, A2, B2, F#2, G2, D2, G2, A2
    bass_pitches = [50, 45, 47, 42, 43, 38, 43, 45]
    total_cycles = 6
    for c in range(total_cycles):
        for i, p in enumerate(bass_pitches):
            start = c * cycle_dur + i * hn
            notes.append((start, hn - 25, p, 75))
            notes.append((start, hn - 25, p - 12, 58))
            
    # 旋律段落
    p1 = [(hn, 74), (hn, 73), (hn, 71), (hn, 69), (hn, 67), (hn, 66), (hn, 67), (hn, 69)]
    p2 = [
        (qn, 62), (qn, 66), (qn, 64), (qn, 62), (qn, 61), (qn, 69), (qn, 73), (qn, 69),
        (qn, 71), (qn, 74), (qn, 69), (qn, 67), (qn, 66), (qn, 62), (qn, 66), (qn, 64)
    ]
    p3 = [
        (en, 62), (en, 66), (en, 69), (en, 67), (en, 66), (en, 69), (en, 74), (en, 73),
        (en, 71), (en, 74), (en, 73), (en, 71), (en, 69), (en, 67), (en, 66), (en, 64),
        (en, 62), (en, 67), (en, 66), (en, 64), (en, 62), (en, 66), (en, 69), (en, 67),
        (en, 66), (en, 71), (en, 69), (en, 67), (en, 66), (en, 64), (en, 62), (en, 61)
    ]
    raw_p4 = [
        74, 73, 74, 78, 76, 74, 73, 71, 73, 76, 69, 71, 73, 74, 76, 78,
        74, 71, 74, 73, 71, 69, 67, 66, 67, 71, 69, 67, 66, 64, 62, 61,
        62, 66, 69, 67, 66, 69, 74, 73, 71, 74, 73, 71, 69, 67, 66, 64,
        62, 67, 66, 64, 62, 66, 69, 67, 66, 71, 69, 67, 66, 64, 62, 61
    ]
    p4 = [(sn, p) for p in raw_p4]
    phrases = [p1, p2, p3, p4]
    
    # 三声部相隔 1 轮依次切入追逐
    for v_idx, delay_cycles in enumerate([1, 2, 3]):
        v_start = delay_cycles * cycle_dur
        tick = v_start
        vel = 88 - v_idx * 5
        for phrase in phrases:
            for dur, pitch in phrase:
                notes.append((tick, dur - 15, pitch, vel))
                tick += dur
                
    return make_midi(notes, tempo_bpm=76)

def gen_bach_prelude():
    # Bach BWV 846 Prelude in C Major arpeggio bars
    # Each bar has 16 sixteenth notes: pattern = [0, 1, 2, 3, 4, 2, 3, 4] x 2
    # Bar 1: C4, E4, G4, C5, E5 (MIDI: 48, 52, 55, 60, 64) -> C3, E3, G3, C4, E4
    bars = [
        [48, 55, 60, 64, 67], # C, G, c, e, g
        [48, 53, 57, 62, 65], # Dm7/C
        [47, 53, 55, 59, 62], # G7/B
        [48, 52, 55, 60, 64], # C
        [48, 52, 57, 60, 65], # Am/C
        [47, 50, 57, 62, 65], # D7/B
        [43, 50, 55, 59, 62], # G
    ]
    notes = []
    tick = 0
    sixteenth = 120 # 480 / 4
    for chord in bars:
        for _ in range(2):
            pattern = [chord[0], chord[1], chord[2], chord[3], chord[4], chord[2], chord[3], chord[4]]
            for p in pattern:
                notes.append((tick, sixteenth * 2, p, 80))
                tick += sixteenth
    return make_midi(notes, tempo_bpm=108)

def gen_sanheju_triads():
    # 申子辰 (水: 56/Ab, 60/C, 64/E)
    # 亥卯未 (木: 59/B, 63/Eb, 67/G)
    # 寅午戌 (火: 62/D, 66/F#, 70/Bb)
    # 巳酉丑 (金: 65/F, 69/A, 73/C#)
    bureaus = [
        ("水局·申子辰", [48, 56, 60, 64, 72]),
        ("木局·亥卯未", [51, 55, 59, 63, 67]),
        ("火局·寅午戌", [54, 58, 62, 66, 70]),
        ("金局·巳酉丑", [57, 61, 65, 69, 73]),
    ]
    notes = []
    tick = 0
    beat = 480
    for _ in range(2):
        for name, chord in bureaus:
            # Arpeggiate
            for p in chord:
                notes.append((tick, beat * 2, p, 85))
                tick += beat // 2
            # Strike chord together
            tick += beat // 2
            for p in chord:
                notes.append((tick, beat * 2, p, 95))
            tick += beat * 2
    return make_midi(notes, tempo_bpm=110)

def gen_pentatonic_moonlight():
    # Chinese Pentatonic (宫商角徵羽: C, D, E, G, A)
    # 60, 62, 64, 67, 69
    melody = [
        (67, 240), (69, 240), (72, 480), (69, 240), (67, 240), (64, 480),
        (60, 240), (62, 240), (64, 480), (67, 480), (64, 240), (62, 240), (60, 960),
        (64, 240), (67, 240), (69, 480), (72, 240), (74, 240), (76, 480),
        (72, 240), (69, 240), (67, 480), (64, 240), (62, 240), (60, 960),
    ]
    notes = []
    tick = 0
    for p, dur in melody:
        # melody
        notes.append((tick, dur, p, 90))
        # bass accompaniment on downbeats
        if tick % 960 == 0:
            notes.append((tick, 960, p - 24, 70))
            notes.append((tick, 960, p - 12, 65))
        tick += dur
    return make_midi(notes, tempo_bpm=96)

def gen_orbital_precession_30s():
    # 30 秒单音轨对数进动：起局(水局加速) -> 进动盘旋(开普勒高位减速) -> 暗区张力 -> 向心坍缩
    # 80 BPM, 40 拍 = 30.00 秒整
    tpq = 480
    qn = tpq
    hn = qn * 2
    wn = qn * 4
    en = qn // 2
    d_qn = qn + en

    notes = []
    curr = 0

    def add_n(dur, pitch, vel=85, gap=20):
        nonlocal curr
        notes.append((curr, dur - gap, pitch, vel))
        curr += dur

    # Stage 1: 起局 (0s - 7.5s, 10 拍)
    add_n(hn, 48, 88)         # C3 (0°, 子)
    add_n(qn, 52, 82)         # E3 (120°, 辰)
    add_n(qn, 56, 85)         # G#3 (240°, 申) -> 完成第一圈水局正三角
    add_n(en, 60, 90)         # C4 (0°)
    add_n(en, 64, 88)         # E4 (120°)
    add_n(en, 68, 88)         # G#4 (240°)
    add_n(en, 69, 86)         # A4 (270°, 借力换轨至金局巳酉丑)
    add_n(qn, 73, 90)         # C#5 (30°, 丑)
    add_n(qn, 76, 92)         # E5 (120°, 辰)
    add_n(hn, 77, 85)         # F5 (150°, 巳) 挂在外圈 2拍

    # Stage 2: 进动盘旋与切线滑行 (7.5s - 16.5s, 12 拍)
    add_n(qn, 74, 80)         # D5 (60°, 火局寅)
    add_n(qn, 78, 84)         # F#5 (180°, 火局午)
    add_n(d_qn, 82, 88)       # A#5 (300°, 火局戌)
    add_n(en, 81, 78)         # A5 (270°)
    add_n(qn, 83, 85)         # B5 (330°, 木局卯)
    add_n(qn, 87, 88)         # D#6 (90°, 木局未) - 远日点最高峰
    add_n(d_qn, 86, 82)       # D6 (60°)
    add_n(en, 83, 75)         # B5 (330°)
    add_n(qn, 79, 80)         # G5 (210°, 木局亥)
    add_n(hn, 76, 85)         # E5 (120°)

    # Stage 3: 暗区与张力留白 (16.5s - 22.5s, 8 拍)
    add_n(d_qn, 71, 78)       # B4 (330°, 导音引力)
    add_n(en, 72, 85)         # C5 (0°, 瞬间触碰)
    add_n(hn, 66, 75)         # F#4 (180°, 增四度深渊暗区，长停顿 2拍)
    add_n(qn, 68, 76)         # G#4 (240°)
    add_n(qn, 70, 78)         # A#4 (300°)
    add_n(hn, 71, 86)         # B4 (330°, 积聚最强解决势能 2拍)

    # Stage 4: 向心坍缩与绝杀解决 (22.5s - 30.0s, 10 拍)
    add_n(en, 69, 82)         # A4 (270°)
    add_n(en, 67, 80)         # G4 (210°)
    add_n(en, 65, 78)         # F4 (150°)
    add_n(en, 64, 76)         # E4 (120°)
    add_n(en, 62, 75)         # D4 (60°)
    add_n(en, 60, 85)         # C4 (0°, 归位初体验)
    add_n(qn, 55, 80)         # G3 (210°, 属音下坠)
    add_n(hn, 48, 92)         # C3 (0°, 低音夯实 2拍)
    add_n(wn + qn, 36, 95, 0) # C2 (0°, 绝杀大共鸣，持续 5拍 = 3.75s -> 正好满 30.00s 整)

    return make_midi(notes, tempo_bpm=80, tpq=tpq)

def gen_orbital_major_triads_30s():
    tpq = 480
    qn = tpq
    hn = qn * 2
    wn = qn * 4
    en = qn // 2
    d_qn = qn + en

    raw_melody = [
        (hn, 48, 88), (qn, 52, 82), (qn, 56, 85),
        (en, 60, 90), (en, 64, 88), (en, 68, 88), (en, 69, 86),
        (qn, 73, 90), (qn, 76, 92), (hn, 77, 85),
        (qn, 74, 80), (qn, 78, 84), (d_qn, 82, 88), (en, 81, 78),
        (qn, 83, 85), (qn, 87, 88), (d_qn, 86, 82), (en, 83, 75),
        (qn, 79, 80), (hn, 76, 85),
        (d_qn, 71, 78), (en, 72, 85), (hn, 66, 75),
        (qn, 68, 76), (qn, 70, 78), (hn, 71, 86),
        (en, 69, 82), (en, 67, 80), (en, 65, 78), (en, 64, 76),
        (en, 62, 75), (en, 60, 85), (qn, 55, 80), (hn, 48, 92),
        (wn + qn, 36, 95)
    ]

    notes = []
    curr = 0
    for dur, p, vel in raw_melody:
        is_do = (p % 12 == 0)
        if dur >= qn:
            notes.append((curr, dur - 20, p, vel))
            notes.append((curr, dur - 20, p + 4, int(vel * 0.85)))
            notes.append((curr, dur - 20, p + 7, int(vel * 0.82)))
        else:
            notes.append((curr, dur - 15, p, vel))
            notes.append((curr, dur - 15, p + 4, int(vel * 0.78)))

        if is_do:
            bass_root = p - 12 if p >= 48 else p
            if bass_root > 48:
                bass_root -= 12
            sub_dur = dur // 2
            notes.append((curr, sub_dur - 20, bass_root, int(vel * 0.95)))
            jump_pitch = bass_root - 7
            if jump_pitch < 24:
                jump_pitch += 12
            notes.append((curr + sub_dur, dur - sub_dur - 20, jump_pitch, int(vel * 0.88)))

        curr += dur

    return make_midi(notes, tempo_bpm=80, tpq=tpq)

def gen_silent_night_spiral_conic_60deg():
    """
    《星际平安夜·对数螺线60度圆锥交错重构》 (Silent Night Spiral Conic 60-Degree Tilt)
    - 卯酉线地平基底: Eb Major (Eb = 90° 卯位 / 东方地平线)
    - 6/8 拍律动: 每拍 = 60° 螺线极角旋转
    - 双臂交错 (Dual-Orbital Arms Hocket):
        - 手 1 (地平之手): 奇数微步发声，主干旋律 (Eb4, G4, Bb4, C5, F5...) -> 亥卯未 木局
        - 手 2 (截面之手): 60° 截面倾角，偶数微步介入，带 +2 半音 (全音程) 与泛音反射 -> 巳酉丑 金局 (金木和合)
    - 地平通奏持续音 (Mao-You Pedal Drone): Eb2 (39) 与 Bb2 (46)
    """
    import math
    tpq = 480
    tempo_bpm = 72
    pulse_ticks = 160  # 1 eighth-note pulse in 6/8 time at 72 BPM = 0.2777s
    
    melody_pulses = [
        # Bar 1-2: "Silent night, holy night"
        (70, 0, 3),   (72, 3, 1), (70, 4, 2),  (67, 6, 6),
        # Bar 3-4: "Silent night, holy night"
        (70, 12, 3),  (72, 15, 1), (70, 16, 2), (67, 18, 6),
        # Bar 5-6: "All is calm, all is bright"
        (77, 24, 4),  (77, 28, 2), (74, 30, 6),
        (75, 36, 4),  (75, 40, 2), (70, 42, 6),
        # Bar 7-8: "Round yon virgin mother and child"
        (72, 48, 4),  (72, 52, 2), (75, 54, 3), (74, 57, 1), (72, 58, 2),
        (70, 60, 3),  (72, 63, 1), (70, 64, 2), (67, 66, 6),
        # Bar 9-10: "Sleep in heavenly peace"
        (77, 72, 4),  (80, 76, 2), (75, 78, 4), (77, 82, 2), (75, 84, 12),
    ]
    
    notes = []
    
    # 1. 通奏低音 Pedal Drone: 卯酉地平轴 Eb2 (39) 与 Bb2 (46)
    total_pulses = 96
    bar_pulses = 6
    for b in range(0, total_pulses, bar_pulses):
        start_tick = b * pulse_ticks
        dur_tick = bar_pulses * pulse_ticks - 30
        notes.append((start_tick, dur_tick, 39, 78))  # Eb2
        notes.append((start_tick, dur_tick, 46, 65))  # Bb2
        
    # 2. 手 1 (主旋律地平之手) 与 手 2 (60° 截面手) 双轨纠缠
    for pitch, s_pulse, d_pulse in melody_pulses:
        start_t = s_pulse * pulse_ticks
        dur_t = d_pulse * pulse_ticks - 25
        
        # 圆锥偏角计算振幅权重
        angle = ((pitch - 60) % 12) * 30.0
        tilt_factor = 1.0 + 0.25 * math.cos(math.radians(angle - 180.0))
        vel = int(85 * tilt_factor)
        
        # 手 1: 地平主旋律 (木局共振)
        notes.append((start_t, dur_t, pitch, vel))
        
        # 手 2: 60° 偏角伴奏手 (+2 半音，相位延迟半个微步 = 80 ticks) -> 金局共振
        h2_pitch = pitch - 12 + 2
        h2_start = start_t + pulse_ticks // 2
        h2_dur = max(int(dur_t * 0.7), 100)
        h2_vel = int(vel * 0.70)
        notes.append((h2_start, h2_dur, h2_pitch, h2_vel))
        
        # 远拱点光芒散斑 (Apoapsis Sparkle): 长音处的八度高音泛音
        if d_pulse >= 6:
            sp_pitch = pitch + 12
            sp_start = start_t + pulse_ticks * 2
            sp_dur = pulse_ticks * 2 - 20
            notes.append((sp_start, sp_dur, sp_pitch, int(vel * 0.60)))
            
    # 尾声大共鸣：地平 Eb3 (51) + Eb4 (63) 纯净静止音
    final_start = 96 * pulse_ticks
    final_dur = 12 * pulse_ticks
    notes.append((final_start, final_dur, 39, 90))  # Eb2
    notes.append((final_start, final_dur, 51, 85))  # Eb3
    notes.append((final_start, final_dur, 63, 80))  # Eb4
    
    return make_midi(notes, tempo_bpm=tempo_bpm, tpq=tpq)

def gen_silent_night_mirror_counterpoint():
    """
    《镜中平安夜·卯酉地平纯镜面反射赋格》(Silent Night Specular Mirror Counterpoint)
    - 镜面基底: 卯酉地平线 (Eb4 = 63, 卯位 90° / 水平 X 轴)
    - 严密物理偏移量算法 (Direct Offset Inversion):
        offset = pitch - 63
        mirror_pitch = 63 - offset = 126 - pitch
    - 几何严格性:
        phi_mirror = -phi_orig (在 Canvas 极坐标上严格沿水平地平线上下对称镜像，绝无心算偏差)
    - 低音通奏底板: 卯酉地平轴 Eb2 (39)
    """
    tpq = 480
    tempo_bpm = 72
    pulse_ticks = 160  # 6/8 meter pulse
    
    melody_pulses = [
        # Bar 1-2: "Silent night, holy night" (5 6 5 3)
        (70, 0, 3),   (72, 3, 1), (70, 4, 2),  (67, 6, 6),
        # Bar 3-4: "Silent night, holy night" (5 6 5 3)
        (70, 12, 3),  (72, 15, 1), (70, 16, 2), (67, 18, 6),
        # Bar 5-6: "All is calm, all is bright" (2 2 7 | 1 1 5)
        (77, 24, 4),  (77, 28, 2), (74, 30, 6),
        (75, 36, 4),  (75, 40, 2), (70, 42, 6),
        # Bar 7-8: "Round yon virgin mother and child"
        (72, 48, 4),  (72, 52, 2), (75, 54, 3), (74, 57, 1), (72, 58, 2),
        (70, 60, 3),  (72, 63, 1), (70, 64, 2), (67, 66, 6),
        # Bar 9-10: "Sleep in heavenly peace"
        (77, 72, 4),  (80, 76, 2), (75, 78, 4), (77, 82, 2), (75, 84, 12),
    ]
    
    notes = []
    
    # 1. 通奏低音: 卯酉地平轴 Eb2 (39)
    total_pulses = 96
    bar_pulses = 6
    for b in range(0, total_pulses, bar_pulses):
        start_tick = b * pulse_ticks
        dur_tick = bar_pulses * pulse_ticks - 30
        notes.append((start_tick, dur_tick, 39, 72))  # Eb2
        notes.append((start_tick, dur_tick, 51, 60))  # Eb3
        
    # 2. 天地双声部纯镜面对位 (直接基于 Eb4 = 63 地平轴计算 offset)
    for pitch, s_pulse, d_pulse in melody_pulses:
        start_t = s_pulse * pulse_ticks
        dur_t = d_pulse * pulse_ticks - 25
        
        # 声部 1: 天上主旋律
        notes.append((start_t, dur_t, pitch, 88))
        
        # 声部 2: 地平纯物理镜面倒影 (精确公式: offset = pitch - 63 -> mirror = 63 - offset = 126 - pitch)
        offset = pitch - 63
        mirror_pitch = 63 - offset
        notes.append((start_t, dur_t, mirror_pitch, 82))
        
        # 在地平极点 (Eb5 = 75 映至 Eb3 = 51) 或长音处触发八度共鸣光斑
        if d_pulse >= 6:
            notes.append((start_t + pulse_ticks * 2, pulse_ticks * 2 - 20, mirror_pitch + 12, 65))
            
    # 尾声：归元于地平卯位 Eb (39, 51, 63)
    final_start = 96 * pulse_ticks
    final_dur = 12 * pulse_ticks
    notes.append((final_start, final_dur, 39, 90))  # Eb2
    notes.append((final_start, final_dur, 51, 85))  # Eb3
    notes.append((final_start, final_dur, 63, 85))  # Eb4
    
    return make_midi(notes, tempo_bpm=tempo_bpm, tpq=tpq)

if __name__ == '__main__':
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'samples')
    os.makedirs(out_dir, exist_ok=True)
    
    with open(os.path.join(out_dir, 'silent_night_mirror_counterpoint.mid'), 'wb') as f:
        f.write(gen_silent_night_mirror_counterpoint())
    with open(os.path.join(out_dir, 'silent_night_spiral_conic_60deg.mid'), 'wb') as f:
        f.write(gen_silent_night_spiral_conic_60deg())
    with open(os.path.join(out_dir, 'orbital_major_triads_30s.mid'), 'wb') as f:
        f.write(gen_orbital_major_triads_30s())
    with open(os.path.join(out_dir, 'orbital_precession_30s.mid'), 'wb') as f:
        f.write(gen_orbital_precession_30s())
    with open(os.path.join(out_dir, 'canon_in_d.mid'), 'wb') as f:
        f.write(gen_canon_in_d())
    with open(os.path.join(out_dir, 'bach_prelude.mid'), 'wb') as f:
        f.write(gen_bach_prelude())
    with open(os.path.join(out_dir, 'sanheju_triads.mid'), 'wb') as f:
        f.write(gen_sanheju_triads())
    with open(os.path.join(out_dir, 'pentatonic_moonlight.mid'), 'wb') as f:
        f.write(gen_pentatonic_moonlight())
        
    print(f'Successfully generated demo MIDIs in {out_dir}')
