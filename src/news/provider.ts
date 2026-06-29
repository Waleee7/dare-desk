// Verified-news layer. Every NewsItem carries a real source + url + timestamp,
// so the bot reasons over attributed headlines (not made-up text). Providers
// implement this; a fallback chain keeps the bot alive if one feed is flaky.

export interface NewsItem {
  headline: string;
  source: string; // publisher (Benzinga, Reuters, ...) — the "verified" attribution
  url: string;
  at: string; // ISO timestamp
  symbols: string[];
}

export interface NewsProvider {
  readonly name: string;
  getHeadlines(symbols: string[], limit: number): Promise<NewsItem[]>;
}
