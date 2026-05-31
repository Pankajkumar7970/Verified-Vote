export const logger = {
  info: (log: any) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', service: 'node-backend', ...log })),
  error: (log: any) => console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', service: 'node-backend', ...log })),
  warn: (log: any) => console.warn(JSON.stringify({ timestamp: new Date().toISOString(), level: 'warn', service: 'node-backend', ...log }))
};
