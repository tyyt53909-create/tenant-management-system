/** 进程指标（渲染时读取，避免额外定时器）。 */
export function processMetrics(): { uptimeSeconds: number; residentMemoryBytes: number } {
  return {
    uptimeSeconds: Math.round(process.uptime()),
    residentMemoryBytes: process.memoryUsage().rss,
  };
}
