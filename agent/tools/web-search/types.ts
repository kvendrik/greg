export interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
}

export interface WebSearchCitation {
  title: string;
  url: string;
}

export interface WebSearchSuccessDetails {
  answer: string;
  citations: WebSearchCitation[];
}
