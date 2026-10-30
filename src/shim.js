// esbuild --inject: every bare reference to Buffer in the bundle resolves to the browser polyfill
import { Buffer } from 'buffer'
export { Buffer }
