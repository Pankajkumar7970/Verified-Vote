/// <reference types="vite/client" />

import "axios";

declare module "axios" {
  export interface AxiosRequestConfig {
    /** When true, the global axios error interceptor will not show a toast. */
    skipToast?: boolean;
  }
}
