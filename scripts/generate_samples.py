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

if __name__ == '__main__':
    out_dir = os.path.expanduser('~/code/gitea/spiral-notation/samples')
    os.makedirs(out_dir, exist_ok=True)
    
    with open(os.path.join(out_dir, 'canon_in_d.mid'), 'wb') as f:
        f.write(gen_canon_in_d())
    with open(os.path.join(out_dir, 'bach_prelude.mid'), 'wb') as f:
        f.write(gen_bach_prelude())
    with open(os.path.join(out_dir, 'sanheju_triads.mid'), 'wb') as f:
        f.write(gen_sanheju_triads())
    with open(os.path.join(out_dir, 'pentatonic_moonlight.mid'), 'wb') as f:
        f.write(gen_pentatonic_moonlight())
        
    print(f'Successfully generated 3 demo MIDIs in {out_dir}')
