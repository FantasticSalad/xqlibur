/** Read only symbol labels, stage-context annotations and links from an index. */
export function parseTable(markdown) {
  return [...markdown.matchAll(/^\|\s*\[`([A-Za-z0-9_\\]+)`(?:\s+\(([^)]+)\))?\]\(([^)]+)\)/gm)].map(
    ([,name,context,href]) => ({name:name.replaceAll('\\',''),context:context?.replace(/^with\s+/,'').replace(/\s+stage$/,''),href})
  );
}
