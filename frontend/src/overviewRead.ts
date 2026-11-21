/** Retry reads only. Never retry validation, permission or expired-login errors. */
export function overviewReadError(error: unknown): string {
  const value = error as {message?: string; name?: string} | null
  const message = value?.message || '暂时无法读取'
  if (value?.name === 'AbortError' || /timeout|timed out|超时/i.test(message)) return '连接超时，请重新读取。'
  if (/failed to fetch|fetch failed|network|load failed/i.test(message)) return '网络连接中断，请重新读取。'
  return message
}

export function isTemporaryReadError(error: unknown): boolean {
  const value = error as {message?: string; name?: string; status?: number} | null
  if (/登录|权限|身份|配置|账号|jwt|unauthorized|forbidden/i.test(value?.message || '')) return false
  return value?.name === 'AbortError' || value?.name === 'TimeoutError' ||
    [502, 503, 504].includes(value?.status || 0) ||
    /failed to fetch|fetch failed|network|load failed|timeout|timed out|超时|暂时不可用|稍后重试/i.test(value?.message || '')
}

export async function readOverviewWithRetry<T>(read: () => Promise<T>, active: () => boolean,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 1500))): Promise<T> {
  try { return await read() }
  catch (error) {
    if (!active() || !isTemporaryReadError(error)) throw error
    await pause()
    if (!active()) throw error
    return read()
  }
}
