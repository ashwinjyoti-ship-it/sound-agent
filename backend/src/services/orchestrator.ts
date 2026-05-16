export class OrchestratorClient {
  private baseUrl = 'https://ncpa-orchestrator.ashwinjyoti.workers.dev';
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async fetch(path: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'X-API-Token': this.token,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Orchestrator ${path}: ${res.status} ${text}`);
    }
    return res.json();
  }

  async getShows(opts: { from?: string; to?: string; venue?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (opts.venue) params.set('venue', opts.venue);
    if (opts.limit) params.set('limit', String(opts.limit));
    return this.fetch(`/api/shows/list?${params}`);
  }

  async getShowById(id: number) {
    return this.fetch(`/api/shows/${id}`);
  }

  async addShow(data: any) {
    return this.fetch('/api/shows/add', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateShow(id: number, data: any) {
    return this.fetch(`/api/shows/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getCrewAvailability(date: string) {
    return this.fetch(`/api/crew/availability?date=${date}`);
  }

  async getAllCrew() {
    return this.fetch('/api/crew/list');
  }

  async getInventory() {
    return this.fetch('/api/inventory/equipment');
  }
}
