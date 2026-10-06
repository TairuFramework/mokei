import { type Monitor, startMonitor } from '@mokei/host-monitor'
import type * as TejikaCLI from '@tejika/cli'
import { runInk } from '@tejika/cli'
import { expect, test, vi } from 'vitest'

import { createMonitorCommand } from '../src/commands/monitor.js'
import { ensureMokeiDaemon } from '../src/daemon.js'

vi.mock('@mokei/host-monitor', () => ({ startMonitor: vi.fn() }))
vi.mock('@tejika/cli', async (importOriginal) => ({
  ...(await importOriginal<typeof TejikaCLI>()),
  runInk: vi.fn(async () => {}),
}))
vi.mock('../src/daemon.js', () => ({ ensureMokeiDaemon: vi.fn(async () => {}) }))

test('prints the monitor URL exactly as returned and disposes after exiting', async () => {
  const dispose = vi.fn(async () => {})
  vi.mocked(startMonitor).mockResolvedValue({
    url: 'http://127.0.0.1:19347/',
    port: 19347,
    token: 'monitor-token',
    disposer: { dispose } as unknown as Monitor['disposer'],
  })
  await createMonitorCommand().parseAsync(['--port', '19347'], { from: 'user' })
  expect(ensureMokeiDaemon).toHaveBeenCalled()
  expect(runInk).toHaveBeenCalledWith(
    expect.objectContaining({ props: { url: 'http://127.0.0.1:19347/' } }),
    { exitOnCtrlC: true },
  )
  expect(dispose).toHaveBeenCalledTimes(1)
})
