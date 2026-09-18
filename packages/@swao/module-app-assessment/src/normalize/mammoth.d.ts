// Ambient type declaration for mammoth (no official @types/mammoth package).
// Declares only the two methods transformer.ts actually invokes.
// #0683: static import required so esbuild can bundle mammoth into the SEA blob.
declare module 'mammoth' {
  const mammoth: {
    convertToMarkdown(input: { path: string }): Promise<{ value: string; messages: unknown[] }>;
    convertToHtml(input: { path: string }): Promise<{ value: string; messages: unknown[] }>;
  };
  export = mammoth;
}
