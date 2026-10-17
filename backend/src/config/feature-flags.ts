/** 虚拟水电表模拟器。只有显式设为 true 才开放，生产默认关闭。 */
export function isMeterSimulatorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FEATURE_METER_SIMULATOR === 'true';
}
