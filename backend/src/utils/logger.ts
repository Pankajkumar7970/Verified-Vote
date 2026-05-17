export const logger = {
  info: (log: any) => console.log(JSON.stringify(log)),
  error: (log: any) => console.error(JSON.stringify(log)),
  warn: (log: any) => console.warn(JSON.stringify(log))
};
