import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, pciAddress, parseNvidiaInformation, parseCgroup, effectiveCgroups, probeEnvironment } from '../skills/research-task/scripts/probe-environment.mjs';

// Parser fixtures are unit inputs, not evidence of tested physical devices.
test('NVIDIA device minor is parsed independently from management tool index',()=>{
  assert.deepEqual(parseNvidiaInformation('Model: Example GPU\nGPU UUID: GPU-aaaa\nBus Location: 0000:25:00.0\nDevice Minor: 7'),{id:'GPU-aaaa',pci:'0000:25:00.0',minor:7,name:'Example GPU'});
  assert.equal(pciAddress('00000000:A3:00.0'),'0000:a3:00.0');assert.equal(pciAddress('../../dev'),null);
  assert.deepEqual(parseCsv('0, GPU-aaaa, 00000000:25:00.0, "GPU, Example", 2000, [N/A], 4'),['0','GPU-aaaa','00000000:25:00.0','GPU, Example','2000','[N/A]','4']);
});
test('cgroup quotas preserve unknown and unlimited states',()=>{
  assert.deepEqual(parseCgroup({'memory.max':'max','memory.current':'1024','cpu.max':'max 100000'}),{memoryLimitBytes:null,memoryUsedBytes:1024,cpuQuotaCores:null});
  assert.deepEqual(parseCgroup({'memory.max':'4096','memory.current':'1024','cpu.max':'150000 100000'}),{memoryLimitBytes:4096,memoryUsedBytes:1024,cpuQuotaCores:1.5});
  assert.deepEqual(parseCgroup({}),{memoryLimitBytes:null,memoryUsedBytes:null,cpuQuotaCores:null});
});
test('shared resource probe reports a timestamped observation without reserving hardware',()=>{
  const snapshot=probeEnvironment();assert.ok(Number.isFinite(Date.parse(snapshot.timestamp)));assert.ok(snapshot.cpu.availableParallelism>0);assert.ok(snapshot.memory.availableEstimateBytes>=0);assert.ok(Array.isArray(snapshot.gpus));assert.match(snapshot.warnings.join(' '),/not reserved/);
});
test('ancestor quotas constrain an unlimited leaf; memory accounts for shared ancestor usage',()=>{
  assert.deepEqual(effectiveCgroups([
    {memoryLimitBytes:null,memoryUsedBytes:100,cpuQuotaCores:null},
    {memoryLimitBytes:4096,memoryUsedBytes:4000,cpuQuotaCores:2},
    {memoryLimitBytes:8192,memoryUsedBytes:2000,cpuQuotaCores:1.5},
  ]),{memoryLimitBytes:4096,memoryUsedBytes:4000,cpuQuotaCores:1.5});
});
