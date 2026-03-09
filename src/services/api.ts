import { API_BASE_URL } from '../config'
import type { LiveMatch, PublicFixturePayload, PublicLeagueSummary } from '../types'

const getJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url)
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(payload.message ?? 'Error de conexión con backend')
  }

  return (await response.json()) as T
}

export const mobileApi = {
  async getPublicClientLeagues(clientId: string): Promise<PublicLeagueSummary[]> {
    const payload = await getJson<{ data: PublicLeagueSummary[] }>(
      `${API_BASE_URL}/api/public/client/${encodeURIComponent(clientId)}/leagues`,
    )

    return payload.data
  },

  async getPublicClientLeagueFixture(clientId: string, leagueId: string, categoryId: string): Promise<PublicFixturePayload> {
    const payload = await getJson<{ data: PublicFixturePayload }>(
      `${API_BASE_URL}/api/public/client/${encodeURIComponent(clientId)}/leagues/${encodeURIComponent(leagueId)}/fixture?categoryId=${encodeURIComponent(categoryId)}`,
    )

    return payload.data
  },

  async getLiveMatch(): Promise<LiveMatch> {
    const payload = await getJson<{ data: LiveMatch }>(`${API_BASE_URL}/api/live/match`)
    return payload.data
  },
}
