#!/usr/bin/env python3
"""
Download 12 classical masterpieces and strip left hand (and pedal).
Keeps pure right-hand melody tracks.
"""
import os
import struct
import urllib.request

CLASSICS = [
    ('Beethoven', 'elise.mid', 'beethoven_elise_right.mid', '贝多芬 · 《致爱丽丝》(Für Elise - 右手纯旋律)'),
    ('Beethoven', 'mond_1.mid', 'beethoven_moonlight_right.mid', '贝多芬 · 《月光奏鸣曲第一乐章》(Moonlight - 右手纯旋律)'),
    ('Beethoven', 'pathetique_1.mid', 'beethoven_pathetique_1_right.mid', '贝多芬 · 《悲怆第一乐章暴风雨》(Pathetique 1 - 右手纯旋律)'),
    ('Beethoven', 'pathetique_2.mid', 'beethoven_pathetique_2_right.mid', '贝多芬 · 《悲怆第二乐章如歌柔板》(Pathetique 2 - 右手纯旋律)'),
    ('Beethoven', 'pathetique_3.mid', 'beethoven_pathetique_3_right.mid', '贝多芬 · 《悲怆第三乐章回旋曲》(Pathetique 3 - 右手纯旋律)'),
    ('Mozart', 'mz_331_3.mid', 'mozart_turca_master_right.mid', '莫扎特 · 《土耳其进行曲大师版》(Rondo alla Turca - 右手纯旋律)'),
    ('Mozart', 'mz_545_1.mid', 'mozart_k545_1_right.mid', '莫扎特 · 《C大调简易奏鸣曲第一乐章》(K.545 - 右手纯旋律)'),
    ('Chopin', 'chp_op18.mid', 'chopin_valse_op18_right.mid', '肖邦 · 《华丽大圆舞曲》(Grande Valse Op.18 - 右手纯旋律)'),
    ('Chopin', 'chpn-p15.mid', 'chopin_raindrop_right.mid', '肖邦 · 《雨滴前奏曲》(Raindrop Prelude - 右手纯旋律)'),
    ('Chopin', 'chpn_op66.mid', 'chopin_fantaisie_right.mid', '肖邦 · 《幻想即兴曲》(Fantaisie-Impromptu - 右手纯旋律)'),
    ('Bach', 'bach_846.mid', 'bach_prelude_846_right.mid', '巴赫 · 《C大调前奏曲》(BWV 846 - 右手纯旋律)'),
    ('Bach', 'bach_847.mid', 'bach_fugue_847_right.mid', '巴赫 · 《C小调赋格》(BWV 847 - 高音声部)'),
    ('Debussy', 'deb_clai.mid', 'debussy_clair_de_lune_right.mid', '德彪西 · 《月光》(Clair de Lune - 右手纯旋律)'),
    ('Liszt', 'liz_et3.mid', 'liszt_campanella_right.mid', '李斯特 · 《钟》(La Campanella - 右手极速钟鸣旋律)'),
    ('Liszt', 'liz_liebestraum.mid', 'liszt_liebestraum_right.mid', '李斯特 · 《爱之梦第三首》(Liebestraum No.3 - 右手纯旋律)'),
    ('Liszt', 'liz_rhap02.mid', 'liszt_hungarian_rhap2_right.mid', '李斯特 · 《匈牙利狂想曲第二号》(Hungarian Rhapsody No.2 - 右手纯旋律)'),
]

BASE_URL = 'https://raw.githubusercontent.com/cheriell/ClassicalPianoMIDI-dataset/main/midis'

def strip_midi_left_hand(midi_bytes):
    fmt, ntrks, division = struct.unpack('>HHH', midi_bytes[8:14])
    idx = 14
    kept_tracks = []
    
    for t_idx in range(ntrks):
        if idx >= len(midi_bytes):
            break
        c_type = midi_bytes[idx:idx+4]
        c_len = struct.unpack('>I', midi_bytes[idx+4:idx+8])[0]
        c_data = midi_bytes[idx+8:idx+8+c_len]
        
        # Check track name
        tname = ''
        for i in range(len(c_data) - 3):
            if c_data[i:i+2] == b'\xFF\x03':
                l = c_data[i+2]
                tname = c_data[i+3:i+3+l].decode('latin1', errors='ignore')
                break
                
        name_lower = tname.lower()
        is_left_or_pedal = ('left' in name_lower or 'links' in name_lower or 'pedal' in name_lower or 'spur' in name_lower)
        
        # Keep Track 0 (conductor / tempo) and right hand tracks
        if t_idx == 0 or (not is_left_or_pedal and ('right' in name_lower or t_idx == 1)):
            kept_tracks.append((c_type, c_data, tname))
            
        idx += 8 + c_len
        
    # Reassemble format 1 MIDI
    hdr = struct.pack('>4sIHHH', b'MThd', 6, 1, len(kept_tracks), division)
    body = b''.join(struct.pack('>4sI', c_type, len(c_data)) + c_data for c_type, c_data, _ in kept_tracks)
    return hdr + body, len(kept_tracks)

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    samples_dir = os.path.join(project_dir, 'samples')
    raw_dir = os.path.join(samples_dir, 'classics_raw')
    os.makedirs(raw_dir, exist_ok=True)
    
    print(f'Starting download of 12 classical masterpieces...')
    for comp, fname, out_fname, title in CLASSICS:
        url = f'{BASE_URL}/{comp}/{fname}'
        raw_path = os.path.join(raw_dir, f'{comp}_{fname}')
        out_path = os.path.join(samples_dir, out_fname)
        
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            raw_bytes = urllib.request.urlopen(req, timeout=10).read()
            with open(raw_path, 'wb') as f:
                f.write(raw_bytes)
                
            stripped_bytes, n_tracks = strip_midi_left_hand(raw_bytes)
            with open(out_path, 'wb') as f:
                f.write(stripped_bytes)
                
            print(f'✓ [OK] {title} -> {out_fname} ({len(stripped_bytes)} bytes, {n_tracks} tracks)')
        except Exception as e:
            print(f'✗ [ERR] {comp}/{fname}: {e}')

if __name__ == '__main__':
    main()
