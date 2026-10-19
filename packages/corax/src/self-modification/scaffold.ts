/** Default authored mount for locally configured self-modification. */
export function renderLocalSelfModificationExtension(): string {
  return `import selfModification from "corax/self-modification/local";\n\nexport default selfModification({\n  // model: "provider/model",\n  // reasoning: "high",\n});\n`;
}
