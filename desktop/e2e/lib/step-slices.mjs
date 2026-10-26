// Which slice of a step-sharded suite (apply, applyflows; JP_REPLAY_SHARD=i/n) runs a step: a step that needs an earlier one (the suite's stepNeeds, past its setup)
// runs where that step ran; a weighed step goes where the greedy split of the measured seconds put it; any other step takes turns (lib/replay-shard.mjs shardTurn).
// 26 Oct 2026: turn-taking put apply's two longest steps in one slice (349 s of a 420 s budget), and "Ready to submit" reads the tab "cannot operate" left
// (its slice must be the same). Guard: test/step-slices.test.mjs (every need shares its slice, every apply step is weighed, the halves are near equal).
import {shardTurn} from './replay-shard.mjs';

// Measured seconds {step-name head: seconds} -> {head: slice index (1-based)}: the costliest first into the lightest slice.
export function weighedSlices(seconds, count) {
  const load = Array(count).fill(0), owner = {};
  for (const [head, cost] of Object.entries(seconds).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const lightest = load.indexOf(Math.min(...load));
    owner[head] = lightest + 1; load[lightest] += cost;
  }
  return owner;
}

// -> (step name) => true when this slice runs it. No shard: every step runs.
export function stepSlicer(shard, {seconds = {}, needs = {}, setup = ''} = {}) {
  if (!shard) return () => true;
  const owner = weighedSlices(seconds, shard.count), decided = [];
  let turn = 0;
  return name => {
    const wanted = Object.entries(needs).filter(([word]) => name.includes(word)).flatMap(([, list]) => list).filter(word => word !== setup);
    const earlier = decided.find(item => wanted.some(word => item.name.includes(word)));
    const head = Object.keys(owner).find(key => name.startsWith(key));
    const takes = earlier ? earlier.takes : head ? owner[head] === shard.index : shardTurn(turn++, shard);
    decided.push({name, takes});
    return takes;
  };
}
