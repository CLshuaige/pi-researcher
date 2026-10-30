#!/usr/bin/env node
// Shared, read-only resource discovery. Inventory and current load are not a reservation.
import * as fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const read = path => { try { return fs.readFileSync(path, 'utf8').trim(); } catch { return null; } };
const list = path => { try { return fs.readdirSync(path); } catch { return []; } };
const real = path => { try { return fs.realpathSync(path); } catch { return null; } };
const writableDevice = path => {
  // Opening a device checks actual process access, unlike metadata checks alone.
  try { if (!fs.statSync(path).isCharacterDevice()) return false; const fd = fs.openSync(path, fs.constants.O_RDWR); fs.closeSync(fd); return true; } catch { return false; }
};
const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export function commandProbe(command, args, timeout = 2500) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
  return { available: r.status === 0, output: (r.stdout || '').trim(), error: r.status === 0 ? null : r.error?.code || r.stderr?.trim().slice(0, 500) || `exit=${r.status}` };
}
export function parseCsv(line) {
  return (line.match(/(?:"(?:[^"]|"")*"|[^,])+(?=,|$)|(?<=,)(?=,|$)/g) || [])
    .map(value => value.trim().replace(/^"(.*)"$/, '$1').replaceAll('""', '"'));
}
export function pciAddress(value) {
  const match = String(value).match(/^(?:0{4})?([\da-f]{4}:[\da-f]{2}:[\da-f]{2}\.\d)$/i);
  return match ? match[1].toLowerCase() : null;
}
export function parseNvidiaInformation(text) {
  const fields = Object.fromEntries(text.split('\n').map(line => { const split = line.indexOf(':'); return [line.slice(0, split).trim(), line.slice(split + 1).trim()]; }));
  return { id: fields['GPU UUID'], pci: pciAddress(fields['Bus Location']), minor: /^\d+$/.test(fields['Device Minor'] || '') ? Number(fields['Device Minor']) : null, name: fields.Model };
}
export function discoverGpus() {
  const diagnostics = [], devices = [];
  if (process.platform !== 'linux') return { devices, diagnostics: ['Detailed GPU device discovery is unavailable on this platform'] };
  const info = list('/proc/driver/nvidia/gpus').map(name => {
    const directory = join('/proc/driver/nvidia/gpus', name), text = read(join(directory, 'information'));
    return text ? { ...parseNvidiaInformation(text), directory } : null;
  }).filter(Boolean);
  // Query stable identifiers and current load together. The CLI is supplied by the installed driver.
  const fields = 'index,uuid,pci.bus_id,name,memory.total,memory.free,utilization.gpu';
  const query = commandProbe('nvidia-smi', [`--query-gpu=${fields}`, '--format=csv,noheader,nounits']);
  let rows = query.available ? query.output.split('\n').filter(Boolean).map(parseCsv) : [];
  if (!query.available) diagnostics.push('NVIDIA inventory/load query unavailable: ' + query.error);
  if (!query.available) rows = info.map(d => [null, d.id, d.pci, d.name, null, null, null]);
  // XML fallback discovers minor numbers when /proc is hidden (e.g. in a container).
  let xml = '';
  if (rows.some(row => !info.some(d => d.id === row[1]))) {
    const q = commandProbe('nvidia-smi', ['-q', '-x']);
    if (q.available) xml = q.output;
  }
  for (const row of rows) {
    if (row.length !== 7 || !/^GPU-[\da-f-]+$/i.test(row[1] || '')) { diagnostics.push('Unrecognized NVIDIA query row'); continue; }
    const [index, id, pci, name, total, free, utilization] = row;
    let details = info.find(d => d.id === id);
    if (!details) {
      const block = [...xml.matchAll(/<gpu\s[^>]*>([\s\S]*?)<\/gpu>/g)].map(m => m[1]).find(block => block.includes(`<uuid>${id}</uuid>`));
      const minor = block?.match(/<minor_number>(\d+)<\/minor_number>/)?.[1];
      if (minor) details = { minor: Number(minor), directory: null };
    }
    const node = details?.minor == null ? null : `/dev/nvidia${details.minor}`;
    const common = ['/dev/nvidiactl', '/dev/nvidia-uvm'].filter(fs.existsSync);
    const paths = node ? [node, ...common] : [];
    const address = pciAddress(pci) || details?.pci || null;
    devices.push({ vendor: 'nvidia', id, pci: address, index: number(index), name, memoryMiB: { total: number(total), free: number(free) }, utilizationPercent: number(utilization), accessible: Boolean(node && fs.existsSync('/dev/nvidiactl') && paths.every(writableDevice)) });
  }
  for (const entry of list('/sys/class/drm').filter(x => /^renderD\d+$/.test(x))) {
    const path = `/sys/class/drm/${entry}/device`, vendor = read(join(path, 'vendor')), pci = pciAddress(real(path)?.split('/').at(-1));
    if (!['0x1002', '0x8086'].includes(vendor) || !pci) continue;
    const devicePaths = [`/dev/dri/${entry}`, ...(vendor === '0x1002' ? ['/dev/kfd'] : [])];
    devices.push({ vendor: vendor === '0x1002' ? 'amd' : 'intel', id: pci, pci, name: `${vendor === '0x1002' ? 'AMD' : 'Intel'} ${read(join(path, 'device')) || 'GPU'}`, memoryMiB: null, utilizationPercent: number(read(join(path, 'gpu_busy_percent'))), accessible: devicePaths.every(writableDevice) });
  }
  return { devices, diagnostics };
}
export function cgroupFiles() {
  const group = read('/proc/self/cgroup')?.split('\n').find(x => x.startsWith('0::'))?.slice(3);
  if (group === undefined) return [];
  const base = resolve('/sys/fs/cgroup', '.' + group);
  if (!base.startsWith('/sys/fs/cgroup/') && base !== '/sys/fs/cgroup') return [];
  const paths = [];
  for (let current = base; ; current = dirname(current)) {
    paths.push(...['memory.max', 'memory.current', 'cpu.max'].map(x => join(current, x)).filter(fs.existsSync));
    if (current === '/sys/fs/cgroup') break;
  }
  return paths;
}
export function parseCgroup(values) {
  const [quota, period] = (values['cpu.max'] || '').split(/\s+/);
  return { memoryLimitBytes: number(values['memory.max'] ?? null), memoryUsedBytes: number(values['memory.current'] ?? null), cpuQuotaCores: number(quota) !== null && number(period) > 0 ? Number(quota) / Number(period) : null };
}
export function effectiveCgroups(groups) {
  const cpu = groups.map(x => x.cpuQuotaCores).filter(x => x !== null);
  const limited = groups.filter(x => x.memoryLimitBytes !== null && x.memoryUsedBytes !== null)
    .sort((a, b) => (a.memoryLimitBytes - a.memoryUsedBytes) - (b.memoryLimitBytes - b.memoryUsedBytes));
  const memory = limited[0] || groups[0] || { memoryLimitBytes: null, memoryUsedBytes: null };
  return { memoryLimitBytes: memory.memoryLimitBytes, memoryUsedBytes: memory.memoryUsedBytes, cpuQuotaCores: cpu.length ? Math.min(...cpu) : null };
}
export function probeEnvironment() {
  const grouped = new Map();
  for (const path of cgroupFiles()) { const parent = dirname(path); if (!grouped.has(parent)) grouped.set(parent, {}); grouped.get(parent)[path.split('/').at(-1)] = read(path); }
  const cgroups = effectiveCgroups([...grouped.values()].map(parseCgroup));
  let disk;
  try { const s = fs.statfsSync(process.cwd()); disk = { availableBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }; } catch (error) { disk = { error: error.code }; }
  const inventory = discoverGpus();
  const hostAvailable = number(read('/proc/meminfo')?.match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024 || os.freemem();
  const limit = cgroups.memoryLimitBytes, used = cgroups.memoryUsedBytes;
  return {
    timestamp: new Date().toISOString(), scope: 'current_agent_runtime_only',
    platform: process.platform, release: os.release(), architecture: process.arch, node: process.version, cwd: process.cwd(),
    gpuVisibility: Object.fromEntries(['CUDA_VISIBLE_DEVICES', 'NVIDIA_VISIBLE_DEVICES', 'HIP_VISIBLE_DEVICES', 'ROCR_VISIBLE_DEVICES', 'ZE_AFFINITY_MASK'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
    cpu: { logicalCores: os.cpus().length, availableParallelism: os.availableParallelism(), loadAverage: os.loadavg(), quotaCores: cgroups.cpuQuotaCores },
    memory: { hostTotalBytes: os.totalmem(), hostAvailableBytes: hostAvailable, cgroupLimitBytes: limit, cgroupUsedBytes: used, availableEstimateBytes: limit !== null && used !== null ? Math.max(0, Math.min(hostAvailable, limit - used)) : hostAvailable },
    disk, gpus: inventory.devices, diagnostics: inventory.diagnostics,
    warnings: [
      'Snapshot only; available resources can change and are not reserved.',
      'Visible hardware is not a resource allocation. Use only what the task needs and respect host budgets.',
      'Device access is not proof that the required computation framework works. Run a small real check before costly work.',
      'No accessible GPU does not establish that the host has no GPU.',
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(probeEnvironment(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
