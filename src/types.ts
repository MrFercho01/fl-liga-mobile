export interface PublicLeagueSummary {
  id: string
  name: string
  slug: string
  country: string
  season: number
  slogan?: string
  themeColor?: string
  backgroundImageUrl?: string
  logoUrl?: string
  categories: Array<{ id: string; name: string }>
}

export interface PublicTeam {
  id: string
  name: string
  logoUrl?: string
  players: Array<{
    id: string
    name: string
    number: number
    position: string
    photoUrl?: string
  }>
}

export interface LiveEvent {
  id: string
  timestamp: string
  teamId: string
  playerId: string | null
  substitutionInPlayerId?: string
  type:
    | 'shot'
    | 'goal'
    | 'penalty_goal'
    | 'penalty_miss'
    | 'yellow'
    | 'red'
    | 'double_yellow'
    | 'assist'
    | 'substitution'
    | 'staff_yellow'
    | 'staff_red'
  staffRole?: 'director' | 'assistant'
  minute: number
  elapsedSeconds: number
  clock: string
}

export interface LiveMatch {
  id: string
  leagueName: string
  categoryName: string
  status: 'scheduled' | 'live' | 'finished'
  homeTeam: {
    id: string
    name: string
    players: Array<{ id: string; name: string }>
    stats: { goals: number }
  }
  awayTeam: {
    id: string
    name: string
    players: Array<{ id: string; name: string }>
    stats: { goals: number }
  }
  timer: {
    running: boolean
    elapsedSeconds: number
  }
  currentMinute: number
  events: LiveEvent[]
}

export interface PublicFixturePayload {
  league: {
    id: string
    name: string
    country: string
    season: number
    themeColor?: string
    logoUrl?: string
  }
  category: { id: string; name: string }
  teams: PublicTeam[]
  fixture: {
    rounds: Array<{
      round: number
      matches: Array<{
        homeTeamId: string
        awayTeamId: string | null
        hasBye: boolean
      }>
    }>
  }
  schedule: Array<{
    matchId: string
    round: number
    scheduledAt: string
    venue?: string
  }>
  playedMatchIds: string[]
  playedMatches: Array<{
    matchId: string
    round: number
    homeTeamName: string
    awayTeamName: string
    homeGoals: number
    awayGoals: number
    finalMinute: number
    playedAt: string
    events: Array<{
      clock: string
      type: LiveEvent['type']
      teamName: string
      playerName: string
      substitutionInPlayerName?: string
    }>
    highlightVideos?: Array<{
      id: string
      name: string
      url: string
    }>
  }>
}

export interface ScheduledMatch {
  id: string
  round: number
  homeTeamId: string
  awayTeamId: string
  played: boolean
  scheduledAt?: string
  venue?: string
}
