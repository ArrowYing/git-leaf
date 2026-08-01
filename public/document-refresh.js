export function shouldReplaceDocumentHtml(currentDocument, nextDocument) {
  if (!currentDocument || !nextDocument) {
    return true;
  }
  return (
    currentDocument.path !== nextDocument.path ||
    currentDocument.kind !== nextDocument.kind ||
    currentDocument.sourceHash !== nextDocument.sourceHash ||
    currentDocument.dependencyHash !== nextDocument.dependencyHash ||
    currentDocument.source !== nextDocument.source ||
    currentDocument.html !== nextDocument.html
  );
}
