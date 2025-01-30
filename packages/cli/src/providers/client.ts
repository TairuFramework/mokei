export type SingleResponse<T> = AbortController & Promise<T>
export type StreamResponse<T> = AbortController & Promise<ReadableStream<T>>
export type SingleOrStreamResponse<T> = SingleResponse<T> | StreamResponse<T>
