import catalogue from '../../reference/catalogue.json';

// Independently written from each symbol's official source page. Keep review
// dates as provenance, never as editor copy. Transpose has only an index entry.
const summaries: Readonly<Record<string,string>> = {
  alter: 'Creates fields or changes existing field values using constants, other fields or function results.',
  arrayexpand: 'Creates a separate row for each array element, repeating the other field values.',
  bin: 'Buckets numeric values or timestamps into ranges for grouping and aggregation.',
  call: 'Uses the results of a saved Query Library query in the current pipeline.',
  cold_dataset: 'Selects a dataset in cold storage as the query source.',
  comp: 'Calculates aggregate results, optionally grouped by field values.',
  config: 'Sets query options such as case sensitivity and the time range.',
  datamodel: 'Queries mapped datasets through the XDM data model.',
  dataset: 'Selects the dataset or datasets to query.',
  dedup: 'Keeps records with distinct combinations of the specified field values.',
  fields: 'Selects, excludes, or renames fields in the query results.',
  filter: 'Keeps records where the condition is true.',
  iploc: 'Adds geographic attributes for IPv4 addresses in a field.',
  join: 'Combines records from the current query and a subquery using a matching condition.',
  limit: 'Caps the number of records passed on from this stage.',
  pivot: 'Turns selected field values into columns containing aggregate results.',
  preset: 'Selects a predefined collection of xdr_data fields and events as the query source.',
  replacenull: 'Replaces null values in a field with a specified value.',
  search: 'Finds text across ingested data in one or more datasets.',
  sort: 'Orders records by one or more fields in ascending or descending order.',
  tag: 'Appends labels to the records\' _tag field.',
  target: 'Saves query results to a dataset or lookup table.',
  top: 'Finds the most common field values with approximate counts and percentages.',
  transaction: 'Groups related events into transactions with event counts and duration information.',
  transpose: 'Transforms rows into columns.',
  union: 'Appends records from another dataset or subquery to the current results.',
  view: 'Configures how results are displayed, including highlights, charts, and column order.',
  windowcomp: 'Calculates results over a window of records while retaining the individual rows.'
};

const stages = new Map(catalogue.symbols.filter(s=>s.kind==='stage').map(s=>[s.name,s]));
export function stageHelp(name:string) {
  const symbol=stages.get(name),summary=Object.hasOwn(summaries,name)?summaries[name]:undefined;
  return symbol&&summary?{summary,source:symbol.source,checked:'2026-11-05'}:undefined;
}
