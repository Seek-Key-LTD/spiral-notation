import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiPlayer } from '../src/audio/midi-player.js';

test('CC 64 延音踏板：踏板踩下时音符保持发声，抬起时彻底释放', () => {
  const player = new MidiPlayer();

  // Mock audio engine
  const triggeredAttacks = [];
  const triggeredReleases = [];
  player.audio = {
    ensureContext: () => ({ state: 'running', currentTime: 0 }),
    ctx: { currentTime: 0 },
    triggerAttack: (m, v) => triggeredAttacks.push({ m, v }),
    triggerRelease: (m) => triggeredReleases.push(m),
    stopAll: () => {}
  };

  // Mock MIDI with 1 note (duration 0.5s) and pedal down (0.2s - 1.5s)
  const mockMidi = {
    tracks: [
      {
        name: 'Piano',
        notes: [
          { midi: 60, time: 0.1, duration: 0.4, velocity: 0.8, name: 'C4' },
          { midi: 72, time: 1.5, duration: 0.4, velocity: 0.8, name: 'C5' }
        ],
        controlChanges: {
          64: [
            { time: 0.2, value: 1.0 }, // 踩下踏板
            { time: 0.9, value: 0.0 }  // 抬起踏板
          ]
        }
      }
    ]
  };

  player.loadMidi(mockMidi);
  assert.equal(player.pedalEvents.length, 2);

  player.isPlaying = true;
  player.startAudioTime = 0;
  player.startPlaybackOffset = 0;

  // Time 0.0s: idle
  player.playbackTime = 0.05;
  player.audio.ctx.currentTime = 0.05;
  player._tick();
  assert.equal(triggeredAttacks.length, 0);

  // Time 0.15s: Note 60 triggered
  player.playbackTime = 0.15;
  player.audio.ctx.currentTime = 0.15;
  player._tick();
  assert.equal(triggeredAttacks.length, 1);
  assert.equal(triggeredAttacks[0].m, 60);
  assert.equal(player.activeVisualNotes.length, 1);

  // Time 0.3s: Pedal is down (0.2s passed)
  player.playbackTime = 0.3;
  player.audio.ctx.currentTime = 0.3;
  player._tick();
  assert.equal(player.isPedalDown, true);

  // Time 0.6s: Key is physically released (0.1 + 0.4 = 0.5s < 0.6s)
  // BUT pedal is still down! Sound should NOT be released!
  player.playbackTime = 0.6;
  player.audio.ctx.currentTime = 0.6;
  player._tick();
  assert.equal(triggeredReleases.length, 0, '踏板踩下时琴弦不应被制音！');
  assert.equal(player.pedalSustainedNotes.size, 1);
  assert.equal(player.activeVisualNotes.length, 1);

  // Time 1.0s: Pedal is released (0.9s passed)
  player.playbackTime = 1.0;
  player.audio.ctx.currentTime = 1.0;
  player._tick();
  assert.equal(player.isPedalDown, false);
  assert.equal(triggeredReleases.length, 1, '踏板抬起时琴弦应被制音！');
  assert.equal(triggeredReleases[0], 60);
  assert.equal(player.pedalSustainedNotes.size, 0);
  assert.equal(player.activeVisualNotes.length, 0);
  player.isPlaying = false;
});
