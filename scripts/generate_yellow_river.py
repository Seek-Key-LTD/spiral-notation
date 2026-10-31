#!/usr/bin/env python3
"""
Generate concert-grade polyphonic piano MIDI for
冼星海 / 殷承宗 / 储望华 《黄河钢琴协奏曲第四乐章 · 保卫黄河》
双手完整演奏版 (双手手势纠缠 + 严格三部轮唱复调卡农 + 东方红华彩尾声 + CC 64 延音踏板)
"""
import struct

def build_yellow_river_midi():
    DIV = 480  # ticks per quarter note
    # 2/4 time signature: measure = 2 beats = 960 ticks
    # Eighth note = 240 ticks, 16th note = 120 ticks, triplet eighth = 160 ticks

    # Pitch mappings in C major:
    # 1=C, 2=D, 3=E, 4=F, 5=G, 6=A, 7=B
    C3, D3, E3, F3, G3, A3, B3 = 48, 50, 52, 53, 55, 57, 59
    C4, D4, E4, F4, G4, A4, B4 = 60, 62, 64, 65, 67, 69, 71
    C5, D5, E5, F5, G5, A5, B5 = 72, 74, 76, 77, 79, 81, 83
    C6, D6, E6, F6, G6, A6, B6 = 84, 86, 88, 89, 91, 93, 95
    C7 = 96
    C2, G2 = 36, 43
    C1 = 24

    # Melody motif: (pitch_offset_from_tonic_C, duration_in_eighths)
    # 1 bar = 2 beats = 4 eighths
    # 风在吼，马在叫，黄河在咆哮，黄河在咆哮！
    # 3 3 3 | 5 5 5 | 6 6 5 3 | 2 - |
    # 2 2 2 | 5 5 5 | 3 2 1 6_ | 5_ - |
    # 3 3 3 | 5 5 5 | 6 6 5 3 | 2 - |
    # 2 2 2 | 5 5 5 | 3 2 1 6_ | 1 - |
    # 万山丛中，抗日英雄真不少；青纱帐里，游击健儿逞英豪！
    # 5 5 6 | 1^ 1^ 6 | 5 5 3 2 | 3 - |
    # 5 5 6 | 1^ 1^ 6 | 5 5 3 2 | 1 - |
    # 端起了土枪洋枪，挥动着大刀长矛；保卫家乡！保卫黄河！保卫华北！保卫全中国！
    # 1^ . 6 | 5 . 3 | 2 3 5 3 | 2 - |
    # 1^ . 6 | 5 . 3 | 2 3 2 1 | 6_ - |
    # 1 2 3 5 | 6 - | 6 5 3 2 | 1 - |

    # Relative to C:
    # 3 = 4 semitones, 5 = 7, 6 = 9, 2 = 2, 1 = 0, 6_ = -3, 5_ = -5, 1^ = 12
    MELODY_DEF = [
        # Bar 1-4
        (4, 1), (4, 1), (4, 2),        # 3 3 3 -
        (7, 1), (7, 1), (7, 2),        # 5 5 5 -
        (9, 1), (9, 1), (7, 1), (4, 1),# 6 6 5 3
        (2, 4),                        # 2 - - -
        # Bar 5-8
        (2, 1), (2, 1), (2, 2),        # 2 2 2 -
        (7, 1), (7, 1), (7, 2),        # 5 5 5 -
        (4, 1), (2, 1), (0, 1), (-3, 1),# 3 2 1 6_
        (-5, 4),                       # 5_ - - -
        # Bar 9-12
        (4, 1), (4, 1), (4, 2),        # 3 3 3 -
        (7, 1), (7, 1), (7, 2),        # 5 5 5 -
        (9, 1), (9, 1), (7, 1), (4, 1),# 6 6 5 3
        (2, 4),                        # 2 - - -
        # Bar 13-16
        (2, 1), (2, 1), (2, 2),        # 2 2 2 -
        (7, 1), (7, 1), (7, 2),        # 5 5 5 -
        (4, 1), (2, 1), (0, 1), (-3, 1),# 3 2 1 6_
        (0, 4),                        # 1 - - -
        # Bar 17-20: 万山丛中...
        (7, 1), (7, 1), (9, 2),        # 5 5 6 -
        (12, 1), (12, 1), (9, 2),      # 1^ 1^ 6 -
        (7, 1), (7, 1), (4, 1), (2, 1),# 5 5 3 2
        (4, 4),                        # 3 - - -
        # Bar 21-24: 青纱帐里...
        (7, 1), (7, 1), (9, 2),        # 5 5 6 -
        (12, 1), (12, 1), (9, 2),      # 1^ 1^ 6 -
        (7, 1), (7, 1), (4, 1), (2, 1),# 5 5 3 2
        (0, 4),                        # 1 - - -
        # Bar 25-28: 端起了土枪洋枪... (dotted eighths: 1.5 + 0.5 = 2 eighths)
        (12, 3), (9, 1),               # 1^ . 6
        (7, 3), (4, 1),                # 5 . 3
        (2, 1), (4, 1), (7, 1), (4, 1),# 2 3 5 3
        (2, 4),                        # 2 - - -
        # Bar 29-32: 保卫家乡！保卫黄河！
        (12, 3), (9, 1),               # 1^ . 6
        (7, 3), (4, 1),                # 5 . 3
        (2, 1), (4, 1), (2, 1), (0, 1),# 2 3 2 1
        (-3, 4),                       # 6_ - - -
        # Bar 33-36: 保卫华北！保卫全中国！
        (0, 1), (2, 1), (4, 1), (7, 1),# 1 2 3 5
        (9, 4),                        # 6 - - -
        (9, 1), (7, 1), (4, 1), (2, 1),# 6 5 3 2
        (0, 4),                        # 1 - - -
    ]

    total_melody_eighths = sum(dur for _, dur in MELODY_DEF) # 36 bars * 4 = 144 eighths

    track_right = [] # (tick, 'on'/'off', pitch, velocity)
    track_left = []
    track_meta = []

    # Tempo: 136 bpm (441176 microseconds per beat)
    track_meta.append((0, 'tempo', 441176))
    track_meta.append((0, 'timesig', 2, 2)) # 2/4
    track_meta.append((0, 'trackname', 'Conductor / Tempo'))

    # Helper to schedule note
    def add_note(trk, start_tick, dur_tick, pitch, vel):
        trk.append((start_tick, 'on', pitch, vel))
        trk.append((start_tick + max(60, dur_tick - 10), 'off', pitch, 0))

    def add_pedal(trk, start_tick, end_tick):
        trk.append((start_tick, 'cc', 64, 127))
        trk.append((end_tick - 20, 'cc', 64, 0))

    cur_tick = 0

    # =========================================================================
    # SECTION 0: 引子 (INTRO) - 狂暴战鼓与号角齐鸣 (8 bars = 32 eighths = 7680 ticks)
    # =========================================================================
    # Bar 1-4: 低音鼓震音 (Tremolo) 与号角音调 (C大调主和弦切分)
    for b in range(4):
        b_tick = cur_tick + b * 960
        add_pedal(track_left, b_tick, b_tick + 940)
        # Low bass rumble (C1-C2 octave)
        for sub in range(4):
            s_tick = b_tick + sub * 240
            add_note(track_left, s_tick, 180, C2, 95 + sub*5)
            add_note(track_left, s_tick, 180, C1, 100)
            if sub % 2 == 1:
                add_note(track_left, s_tick, 160, G2, 88)
        # Right hand fanfare chords: (E4+G4+C5)
        if b in (0, 2):
            add_note(track_right, b_tick, 440, G4, 90)
            add_note(track_right, b_tick, 440, C5, 95)
            add_note(track_right, b_tick, 440, E5, 100)
            add_note(track_right, b_tick + 480, 440, G5, 105)
            add_note(track_right, b_tick + 480, 440, C6, 110)
        elif b == 1:
            add_note(track_right, b_tick, 320, A5, 100)
            add_note(track_right, b_tick + 360, 200, G5, 95)
            add_note(track_right, b_tick + 560, 360, E5, 92)
        elif b == 3:
            add_note(track_right, b_tick, 700, C6, 112)
            add_note(track_right, b_tick, 700, G5, 105)
            add_note(track_right, b_tick, 700, E5, 100)

    # Bar 5-8: 奔腾向上的五声音阶刮奏飞瀑 (Glissando / Arpeggio sweeps)
    cur_tick += 4 * 960
    sweep_pitches = [C3, E3, G3, A3, C4, D4, E4, G4, A4, C5, D5, E5, G5, A5, C6, E6]
    for i, p in enumerate(sweep_pitches):
        add_note(track_right, cur_tick + i * 120, 200, p, 80 + int(i * 2.5))
        if i % 4 == 0:
            add_note(track_left, cur_tick + i * 120, 400, C2 if i < 8 else G2, 95)
    cur_tick += 2 * 960 # 8 * 240 ticks

    # Bar 7-8: 终极重音预备 (Two thunderous chords)
    add_pedal(track_left, cur_tick, cur_tick + 960 * 2 - 40)
    for rep in range(2):
        r_tick = cur_tick + rep * 960
        add_note(track_left, r_tick, 400, C2, 115)
        add_note(track_left, r_tick, 400, C1, 120)
        add_note(track_right, r_tick, 400, C5, 110)
        add_note(track_right, r_tick, 400, E5, 112)
        add_note(track_right, r_tick, 400, G5, 115)
        add_note(track_right, r_tick, 400, C6, 118)
    cur_tick += 2 * 960

    # =========================================================================
    # SECTION 1: 第一通 - 独奏主题 (SOLO THEME, 36 bars = 144 eighths = 34560 ticks)
    # =========================================================================
    sec1_start = cur_tick
    # Right hand: Single melody with occasional octave reinforcement
    t_offset = sec1_start
    for pitch_rel, dur_eighth in MELODY_DEF:
        dur_tick = dur_eighth * 240
        p = C5 + pitch_rel
        # Octave doublings for emphasis on long notes
        if dur_eighth >= 3:
            add_note(track_right, t_offset, dur_tick, p, 96)
            add_note(track_right, t_offset, dur_tick, p + 12, 92)
        else:
            add_note(track_right, t_offset, dur_tick, p, 88)
        t_offset += dur_tick

    # Left hand: 经典战马奔腾低音 (Galloping Bass: C2 bass + mid chords E3/G3)
    for b in range(36):
        b_tick = sec1_start + b * 960
        # Pedal on beat 1, lift at end of bar
        add_pedal(track_left, b_tick, b_tick + 920)
        # Root note determination based on bar
        # Harmonize with C, F, G:
        # Bars 1-3: C, Bar 4: G
        # Bars 5-7: G/C, Bar 8: G
        # Bars 9-11: C, Bar 12: G
        # Bars 13-16: C
        # Bars 17-20: C -> F -> C -> G
        # Bars 21-24: C -> F -> G -> C
        # Bars 25-28: F -> C -> G -> G
        # Bars 29-32: F -> C -> G -> Am
        # Bars 33-36: F -> G -> G -> C
        root = C2
        chord = (E3, G3)
        if b in (3, 7, 11, 23, 27, 31, 34):
            root = G2
            chord = (D3, G3, B3)
        elif b in (17, 21, 25, 29, 32):
            root = F3 - 12 # F2
            chord = (F3, A3, C4)
        elif b == 30:
            root = A3 - 12 # A2
            chord = (E3, A3, C4)

        # Galloping rhythm: 1 beat = 480 ticks
        # Beat 1: Bass note (0-200) + chord (240-440)
        # Beat 2: Alternate bass (480-680) + chord (720-920)
        add_note(track_left, b_tick, 220, root, 92)
        add_note(track_left, b_tick, 220, root - 12, 95)
        for cp in chord:
            add_note(track_left, b_tick + 240, 200, cp, 75)
        add_note(track_left, b_tick + 480, 220, root + 7 if root == C2 else root, 88)
        for cp in chord:
            add_note(track_left, b_tick + 720, 200, cp, 78)

    cur_tick += 36 * 960

    # =========================================================================
    # SECTION 2: 第二通 - 双声部复调卡农轮唱 (CANON A 2, 38 bars = 36480 ticks)
    # Voice 1 in Soprano (C6), Voice 2 enters 2 bars (8 eighths = 1920 ticks) later in Tenor (C5)
    # =========================================================================
    sec2_start = cur_tick
    # Voice 1 (Right Hand - Soprano high register, octaves)
    t_offset = sec2_start
    for pitch_rel, dur_eighth in MELODY_DEF:
        dur_tick = dur_eighth * 240
        p = C6 + pitch_rel
        add_note(track_right, t_offset, dur_tick, p, 98)
        add_note(track_right, t_offset, dur_tick, p - 12, 90)
        t_offset += dur_tick

    # Voice 2 (Enters at +2 bars = +1920 ticks in Tenor / Alto register)
    v2_start = sec2_start + 2 * 960
    t_offset_v2 = v2_start
    for pitch_rel, dur_eighth in MELODY_DEF:
        dur_tick = dur_eighth * 240
        p = C5 + pitch_rel
        # Shared between right and left hands:
        # Put into Track Right or Left depending on register
        add_note(track_left, t_offset_v2, dur_tick, p, 94)
        t_offset_v2 += dur_tick

    # Left hand accompaniment for Section 2:
    # 疾风波浪式十六分音符分解琶音 (Running 16th arpeggios: 8 notes per bar)
    for b in range(38):
        b_tick = sec2_start + b * 960
        add_pedal(track_left, b_tick, b_tick + 920)
        # Deep bass strike on beat 1
        add_note(track_left, b_tick, 300, C2, 100)
        add_note(track_left, b_tick, 300, C1, 105)
        # Running 16th arpeggios
        arp_pattern = [C3, G3, C4, E4, G4, E4, C4, G3]
        for step, ap in enumerate(arp_pattern):
            add_note(track_left, b_tick + step * 120, 110, ap, 72 + (step % 4) * 3)

    cur_tick += 38 * 960

    # =========================================================================
    # SECTION 3: 第三通 - 三部大轮唱与怒涛三连音 (CANON A 3, 40 bars = 38400 ticks)
    # Voice 1 (Treble Octaves), Voice 2 (+2 bars), Voice 3 (+4 bars in Bass)
    # =========================================================================
    sec3_start = cur_tick
    # Voice 1
    t_offset = sec3_start
    for pitch_rel, dur_eighth in MELODY_DEF:
        dur_tick = dur_eighth * 240
        p = C6 + pitch_rel
        add_note(track_right, t_offset, dur_tick, p, 105)
        add_note(track_right, t_offset, dur_tick, p + 12, 100) # Sparkle in C7!
        t_offset += dur_tick

    # Voice 2 (+2 bars)
    v2_start = sec3_start + 2 * 960
    t_offset_v2 = v2_start
    for pitch_rel, dur_eighth in MELODY_DEF:
        dur_tick = dur_eighth * 240
        p = C5 + pitch_rel
        add_note(track_right, t_offset_v2, dur_tick, p, 96)
        t_offset_v2 += dur_tick

    # Voice 3 (+4 bars in Bass register C4)
    v3_start = sec3_start + 4 * 960
    t_offset_v3 = v3_start
    for pitch_rel, dur_eighth in MELODY_DEF:
        dur_tick = dur_eighth * 240
        p = C4 + pitch_rel
        add_note(track_left, t_offset_v3, dur_tick, p, 102)
        add_note(track_left, t_offset_v3, dur_tick, p - 12, 105) # Octave bass thunder!
        t_offset_v3 += dur_tick

    # Left hand accompaniment for Section 3: 狂暴三连音怒潮 (Triplet torrents, 6 notes per bar)
    for b in range(40):
        b_tick = sec3_start + b * 960
        add_pedal(track_left, b_tick, b_tick + 920)
        # Deep octave hammer on each beat
        add_note(track_left, b_tick, 400, C2, 110)
        add_note(track_left, b_tick, 400, C1, 112)
        add_note(track_left, b_tick + 480, 400, G2, 108)
        # 6 triplet eighths per bar (160 ticks each)
        for tri in range(6):
            t_tri = b_tick + tri * 160
            add_note(track_left, t_tri, 150, [C3, E3, G3, C4, G3, E3][tri], 82)

    cur_tick += 40 * 960

    # =========================================================================
    # SECTION 4: 第四通 - 终极大齐奏与《东方红》宏伟华彩尾声 (CODA, 24 bars = 23040 ticks)
    # =========================================================================
    # Accelerando to 144 bpm (416666 us)
    track_meta.append((cur_tick, 'tempo', 416666))
    coda_start = cur_tick

    # 1. 战鼓狂飙齐奏 (Bars 1-8): 双手双八度超级最强音 (ffff)
    # "保卫家乡！保卫黄河！保卫华北！保卫全中国！" 连续重拳出击
    climax_phrases = [
        # (pitches, dur_eighths)
        (C6, 3), (A5, 1), (G5, 3), (E5, 1),
        (D5, 1), (E5, 1), (G5, 1), (E5, 1), (D5, 4),
        (C6, 3), (A5, 1), (G5, 3), (E5, 1),
        (D5, 1), (E5, 1), (D5, 1), (C5, 1), (A4, 4),
        (C5, 1), (D5, 1), (E5, 1), (G5, 1), (A5, 4),
        (A5, 1), (G5, 1), (E5, 1), (D5, 1), (C5, 4),
    ]
    t_climax = coda_start
    for p, dur in climax_phrases:
        dur_tick = dur * 240
        # Full keyboard octave explosion: C4, C5, C6, C7
        add_note(track_right, t_climax, dur_tick, p, 115)
        add_note(track_right, t_climax, dur_tick, p + 12, 118)
        add_note(track_left, t_climax, dur_tick, p - 12, 112)
        add_note(track_left, t_climax, dur_tick, p - 24, 115)
        t_climax += dur_tick

    # 2. 《东方红》晨曦动机穿透黄河惊涛 (Bar 17-20: 5 5 6 2 | 1 1 6_ 5_ ...)
    dfh_start = coda_start + 12 * 960
    dfh_notes = [
        (G5, 2), (G5, 2), (A5, 2), (D6, 2),
        (C6, 3), (A5, 1), (G5, 4),
        (E5, 2), (G5, 2), (A5, 3), (G5, 1),
        (E5, 2), (D5, 2), (C5, 4),
    ]
    t_dfh = dfh_start
    for p, dur in dfh_notes:
        dur_tick = dur * 240
        add_note(track_right, t_dfh, dur_tick, p, 120)
        add_note(track_right, t_dfh, dur_tick, p + 12, 115)
        add_note(track_left, t_dfh, dur_tick, p - 12, 110)
        # Left hand massive harp sweeps under Dongfanghong
        add_pedal(track_left, t_dfh, t_dfh + dur_tick - 20)
        t_dfh += dur_tick

    # 3. 终曲天地大圆满：全音域三连大三和弦震撼雷击 (Final 4 bars)
    final_start = dfh_start + 8 * 960
    final_chords = [C2, C3, G3, C4, E4, G4, C5, E5, G5, C6, E6, G6, C7]
    for rep in range(3):
        f_tick = final_start + rep * 960
        add_pedal(track_left, f_tick, f_tick + 920)
        for p in final_chords:
            if p >= C5:
                add_note(track_right, f_tick, 800, p, 122 + rep*2)
            else:
                add_note(track_left, f_tick, 800, p, 124 + rep)

    # Long sustained ending (Bar 24)
    end_tick = final_start + 3 * 960
    add_pedal(track_left, end_tick, end_tick + 960 * 3) # 3 bars ring out!
    for p in final_chords:
        if p >= C5:
            add_note(track_right, end_tick, 960 * 2, p, 127)
        else:
            add_note(track_left, end_tick, 960 * 2, p, 127)

    cur_tick = end_tick + 960 * 3

    # =========================================================================
    # SERIALIZE TO STANDARD MIDI FILE FORMAT 1 (3 Tracks)
    # =========================================================================
    def events_to_mtrk(events, is_meta=False):
        # Sort by tick, then note_off before note_on
        type_priority = {'tempo': 0, 'timesig': 0, 'trackname': 0, 'cc': 1, 'off': 2, 'on': 3}
        events.sort(key=lambda x: (x[0], type_priority.get(x[1], 4)))
        
        data = bytearray()
        last_tick = 0
        
        def write_varlen(val):
            res = bytearray()
            res.append(val & 0x7F)
            val >>= 7
            while val > 0:
                res.insert(0, (val & 0x7F) | 0x80)
                val >>= 7
            return res

        for ev in events:
            tick = ev[0]
            dt = max(0, tick - last_tick)
            last_tick = tick
            data.extend(write_varlen(dt))
            
            ev_type = ev[1]
            if ev_type == 'tempo':
                data.append(0xFF); data.append(0x51); data.append(3)
                data.extend(ev[2].to_bytes(3, 'big'))
            elif ev_type == 'timesig':
                data.append(0xFF); data.append(0x58); data.append(4)
                data.extend([ev[2], ev[3], 24, 8])
            elif ev_type == 'trackname':
                name_bytes = ev[2].encode('utf-8')
                data.append(0xFF); data.append(0x03); data.append(len(name_bytes))
                data.extend(name_bytes)
            elif ev_type == 'cc':
                data.append(0xB0); data.append(ev[2]); data.append(ev[3])
            elif ev_type == 'on':
                data.append(0x90); data.append(ev[2]); data.append(ev[3])
            elif ev_type == 'off':
                data.append(0x80); data.append(ev[2]); data.append(0)

        # End of track
        data.extend(write_varlen(0))
        data.extend([0xFF, 0x2F, 0x00])
        
        # MTrk chunk
        header = b'MTrk' + struct.pack('>I', len(data))
        return header + bytes(data)

    track_right.append((0, 'trackname', 'Right Hand (Soprano / Octaves / Canon)'))
    track_left.append((0, 'trackname', 'Left Hand (Bass / Torrents / Pedal)'))

    mtrk_meta = events_to_mtrk(track_meta, is_meta=True)
    mtrk_right = events_to_mtrk(track_right)
    mtrk_left = events_to_mtrk(track_left)

    # MThd header: Format 1, 3 tracks, division DIV
    mthd = b'MThd' + struct.pack('>IHHH', 6, 1, 3, DIV)
    full_midi = mthd + mtrk_meta + mtrk_right + mtrk_left

    # Also build right-hand-only version
    mthd_right_only = b'MThd' + struct.pack('>IHHH', 6, 1, 2, DIV)
    right_only_midi = mthd_right_only + mtrk_meta + mtrk_right

    out_full = '/Users/ben/code/gitea/media/spiral-notation/samples/yellow_river_defend_full.mid'
    out_right = '/Users/ben/code/gitea/media/spiral-notation/samples/yellow_river_defend_right.mid'

    with open(out_full, 'wb') as f:
        f.write(full_midi)
    with open(out_right, 'wb') as f:
        f.write(right_only_midi)

    duration_sec = (cur_tick / DIV) * (441176 / 1000000.0)
    print(f'✅ Successfully generated:')
    print(f'  {out_full} ({len(full_midi)} bytes, duration ~{duration_sec:.1f}s / {duration_sec/60:.2f}min)')
    print(f'  {out_right} ({len(right_only_midi)} bytes)')

if __name__ == '__main__':
    build_yellow_river_midi()
