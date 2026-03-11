import { StatusBar } from 'expo-status-bar'
import { VideoView, useVideoPlayer } from 'expo-video'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Notifications from 'expo-notifications'
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useLiveSocket } from './src/hooks/useLiveSocket'
import { mobileApi } from './src/services/api'
import type { LiveEvent, LiveMatch, PublicClientSummary, ScheduledMatch } from './src/types'

const queryClient = new QueryClient()
const defaultFLLogo = require('./assets/icon.png')
const webLogoUri = 'https://fl-liga-frontend.vercel.app/logo.png'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

type AppStep = 'company' | 'league' | 'matches' | 'match'
type LeagueTab = 'matches' | 'overview'
type MatchTab = 'pitch' | 'events' | 'highlights'
type OverviewTab = 'standings' | 'scorers' | 'assists' | 'yellows' | 'reds' | 'goalkeepers'

interface PlayerRanking {
  playerId: string
  playerName: string
  playerNumber: number
  teamId: string
  teamName: string
  teamLogoUrl?: string
  position: string
  matches: number
  goals: number
  assists: number
  yellows: number
  reds: number
}

interface StandingsRow {
  teamId: string
  teamName: string
  teamLogoUrl?: string
  pj: number
  pg: number
  pe: number
  pp: number
  gf: number
  gc: number
  dg: number
  pts: number
}

interface GoalkeeperRanking {
  playerId: string
  playerName: string
  playerNumber: number
  teamId: string
  teamName: string
  matches: number
  cleanSheets: number
  goalsConceded: number
}

const createManualMatchId = (round: number, homeTeamId: string, awayTeamId: string) =>
  `manual__${round}__${homeTeamId}__${awayTeamId}`

function HighlightVideoCard({ name, url, width }: { name: string; url: string; width: number }) {
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = false
  })

  return (
    <View style={[styles.videoRow, { width }]}>
      <Text style={styles.videoName}>{name}</Text>
      <VideoView
        player={player}
        style={styles.videoPlayer}
        nativeControls
        allowsFullscreen
        allowsPictureInPicture
        contentFit="contain"
      />
    </View>
  )
}

const parseMatchIdentity = (matchId: string, fallbackRound?: number) => {
  if (matchId.startsWith('manual__')) {
    const [prefix, rawRound, homeTeamId, awayTeamId] = matchId.split('__')
    const parsedRound = Number(rawRound)
    if (prefix === 'manual' && Number.isFinite(parsedRound) && homeTeamId && awayTeamId) {
      return { round: parsedRound, homeTeamId, awayTeamId }
    }
  }

  if (matchId.startsWith('manual-')) {
    const parsed = matchId.replace('manual-', '')
    const firstDash = parsed.indexOf('-')
    if (firstDash > 0) {
      const parsedRound = Number(parsed.slice(0, firstDash))
      const ids = parsed.slice(firstDash + 1).split('-')
      if (Number.isFinite(parsedRound) && ids.length >= 10) {
        const homeTeamId = ids.slice(0, 5).join('-')
        const awayTeamId = ids.slice(5).join('-')
        if (homeTeamId && awayTeamId) {
          return { round: parsedRound, homeTeamId, awayTeamId }
        }
      }
    }
  }

  // Formato generado: "{round}-{index}-{homeUUID}-{awayUUID}" → 12 partes al dividir por '-'
  const parts = matchId.split('-')
  if (parts.length === 12) {
    const parsedRound = Number(parts[0])
    const homeTeamId = parts.slice(2, 7).join('-')
    const awayTeamId = parts.slice(7, 12).join('-')
    if (Number.isFinite(parsedRound) && homeTeamId.length === 36 && awayTeamId.length === 36) {
      return { round: parsedRound, homeTeamId, awayTeamId }
    }
  }

  if (fallbackRound && Number.isFinite(fallbackRound)) {
    return null
  }

  return null
}

const buildRoundTeamsKey = (round: number, homeTeamId: string, awayTeamId: string) => `${round}:${homeTeamId}:${awayTeamId}`

const normalizePlayerKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bbanco\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const buildTeamNameAliases = (value: string) => {
  const normalized = normalizePlayerKey(value)
  const withoutBanco = normalized.replace(/\bbanco\b/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(new Set([normalized, withoutBanco].filter(Boolean)))
}

const parseFormationLines = (formationKey?: string) => {
  if (!formationKey) return null
  const values = formationKey
    .split('-')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((part) => Number.isFinite(part) && part > 0)

  return values.length > 0 ? values : null
}

const buildVisualLines = <T extends { id: string }>(players: T[], formationKey?: string) => {
  if (players.length === 0) return [] as T[][]
  if (players.length === 1) return [players]

  const parsedFormation = parseFormationLines(formationKey)
  if (parsedFormation) {
    const lines: T[][] = []
    let cursor = 0

    parsedFormation.forEach((lineSize) => {
      lines.push(players.slice(cursor, cursor + lineSize))
      cursor += lineSize
    })

    if (cursor < players.length) {
      const lastLine = lines[lines.length - 1] ?? []
      lines[lines.length - 1] = [...lastLine, ...players.slice(cursor)]
    }

    return lines.filter((line) => line.length > 0)
  }

  const goalkeeper = players.slice(0, 1)
  const outfield = players.slice(1)
  if (outfield.length === 0) return [goalkeeper]

  const lineCount = outfield.length >= 9 ? 4 : outfield.length >= 6 ? 3 : 2
  const base = Math.floor(outfield.length / lineCount)
  let remainder = outfield.length % lineCount
  let cursor = 0

  const lines: T[][] = [goalkeeper]
  for (let index = 0; index < lineCount; index += 1) {
    const size = base + (remainder > 0 ? 1 : 0)
    remainder -= remainder > 0 ? 1 : 0
    lines.push(outfield.slice(cursor, cursor + size))
    cursor += size
  }

  return lines.filter((line) => line.length > 0)
}

const eventLabel: Record<LiveEvent['type'], string> = {
  shot: 'Remate',
  goal: 'Gol',
  penalty_goal: 'Gol de penal',
  penalty_miss: 'Penal fallado',
  yellow: 'TA',
  red: 'TR',
  double_yellow: 'Doble amarilla',
  assist: 'Asistencia',
  substitution: 'Cambio',
  staff_yellow: 'TA cuerpo técnico',
  staff_red: 'TR cuerpo técnico',
}

const normalizeHexColor = (value?: string) => {
  if (!value) return null
  const raw = value.trim()
  if (/^#([0-9a-fA-F]{6})$/.test(raw)) return raw
  if (/^#([0-9a-fA-F]{3})$/.test(raw)) {
    const [r, g, b] = raw.slice(1).split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  if (/^([0-9a-fA-F]{6})$/.test(raw)) return `#${raw}`
  return null
}

const withAlpha = (hex: string | undefined, alphaHex: string) => {
  const value = normalizeHexColor(hex)
  if (!value) return '#020617'
  return `${value}${alphaHex}`
}

const toRelativeChannel = (channel: number) => {
  const normalized = channel / 255
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

const getRelativeLuminance = (hexColor: string) => {
  const normalized = normalizeHexColor(hexColor)
  if (!normalized) return 0

  const r = parseInt(normalized.slice(1, 3), 16)
  const g = parseInt(normalized.slice(3, 5), 16)
  const b = parseInt(normalized.slice(5, 7), 16)

  return 0.2126 * toRelativeChannel(r) + 0.7152 * toRelativeChannel(g) + 0.0722 * toRelativeChannel(b)
}

const getContrastColor = (hexColor: string): string => {
  const luminance = getRelativeLuminance(hexColor)
  const contrastWithWhite = (1.05 / (luminance + 0.05))
  const contrastWithBlack = ((luminance + 0.05) / 0.05)
  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#0f172a'
}

const getAccentColor = (hexColor: string): string => {
  return getContrastColor(hexColor) === '#ffffff' ? '#e2e8f0' : '#0f172a'
}

const getTeamColor = (teamIdOrTeam: string | { id: string; primaryColor?: string; secondaryColor?: string }, useSecondary = false): string => {
  const teamId = typeof teamIdOrTeam === 'string' ? teamIdOrTeam : teamIdOrTeam.id
  const primaryColor = typeof teamIdOrTeam === 'object' ? teamIdOrTeam.primaryColor : undefined
  const secondaryColor = typeof teamIdOrTeam === 'object' ? teamIdOrTeam.secondaryColor : undefined

  // Si se solicita color secundario y existe, usarlo
  if (useSecondary && secondaryColor) {
    return secondaryColor
  }

  // Si hay color primario, usarlo
  if (primaryColor) {
    return primaryColor
  }

  // Caso contrario, generar color a partir del hash del ID
  let hash = 0
  for (let i = 0; i < teamId.length; i++) {
    hash = teamId.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  const saturation = 65 + (Math.abs(hash >> 8) % 20)
  const lightness = 50 + (Math.abs(hash >> 16) % 15)
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

const getMatchTeamColors = (homeTeam: { id: string; primaryColor?: string; secondaryColor?: string } | undefined, awayTeam: { id: string; primaryColor?: string; secondaryColor?: string } | undefined) => {
  const homeColor = homeTeam ? getTeamColor(homeTeam) : '#3b82f6'
  const awayColorPrimary = awayTeam ? getTeamColor(awayTeam) : '#ef4444'
  
  // Si los colores son muy similares, usar el color secundario del visitante
  if (homeColor === awayColorPrimary && awayTeam?.secondaryColor) {
    return {
      home: homeColor,
      away: getTeamColor(awayTeam, true)
    }
  }
  
  return {
    home: homeColor,
    away: awayColorPrimary
  }
}

const formatScheduleLabel = (isoDate?: string) => {
  if (!isoDate) return ''
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return ''

  const date = parsed.toLocaleDateString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Guayaquil',
  })
  const time = parsed.toLocaleTimeString('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Guayaquil',
    hour12: false,
  })

  return `${date} ${time}`
}

const MobileLiveApp = () => {
  const screenWidth = Dimensions.get('window').width
  const highlightCardWidth = Math.max(260, Math.min(360, screenWidth - 56))

  const [step, setStep] = useState<AppStep>('company')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedLeagueId, setSelectedLeagueId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedRound, setSelectedRound] = useState(1)
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [activeLeagueTab, setActiveLeagueTab] = useState<LeagueTab>('matches')
  const [activeMatchTab, setActiveMatchTab] = useState<MatchTab>('pitch')
  const [activeOverviewTab, setActiveOverviewTab] = useState<OverviewTab>('standings')
  const [liveMatch, setLiveMatch] = useState<LiveMatch | null>(null)
  const [followedMatchId, setFollowedMatchId] = useState('')
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)

  const clientsQuery = useQuery({
    queryKey: ['public-clients'],
    queryFn: mobileApi.getPublicClients,
    staleTime: 60_000,
  })

  const selectedClient = useMemo<PublicClientSummary | null>(
    () => clientsQuery.data?.find((client) => client.id === selectedClientId) ?? null,
    [clientsQuery.data, selectedClientId],
  )

  const leagues = selectedClient?.leagues ?? []
  const selectedLeague = useMemo(
    () => leagues.find((league) => league.id === selectedLeagueId) ?? null,
    [leagues, selectedLeagueId],
  )

  const categories = selectedLeague?.categories ?? []
  const activeCategory = categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null

  const fixtureQuery = useQuery({
    queryKey: ['public-fixture', selectedClient?.publicRouteAlias, selectedLeagueId, activeCategory?.id],
    queryFn: () =>
      mobileApi.getPublicClientLeagueFixture(
        selectedClient?.publicRouteAlias ?? selectedClient?.id ?? '',
        selectedLeagueId,
        activeCategory?.id ?? '',
      ),
    enabled: Boolean(step !== 'company' && selectedClient && selectedLeagueId && activeCategory?.id),
    staleTime: 30_000,
  })

  const fetchLive = useCallback(async () => {
    try {
      const snapshot = await mobileApi.getLiveMatch()
      setLiveMatch(snapshot)
    } catch {
      setLiveMatch(null)
    }
  }, [])

  useLiveSocket({
    onUpdate: setLiveMatch,
  })

  useEffect(() => {
    void fetchLive()
    const timer = setInterval(() => {
      void fetchLive()
    }, 15_000)

    return () => clearInterval(timer)
  }, [fetchLive])

  useEffect(() => {
    void (async () => {
      const permission = await Notifications.getPermissionsAsync()
      if (permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
        setNotificationsEnabled(true)
      }
    })()
  }, [])

  useEffect(() => {
    const firstClient = clientsQuery.data?.[0]
    if (!firstClient) return
    setSelectedClientId((current) => current || firstClient.id)
  }, [clientsQuery.data])

  useEffect(() => {
    const firstLeague = leagues[0]
    if (!firstLeague) {
      setSelectedLeagueId('')
      setSelectedCategoryId('')
      return
    }

    setSelectedLeagueId((current) =>
      current && leagues.some((league) => league.id === current) ? current : firstLeague.id,
    )

    setSelectedCategoryId((current) => {
      const hasCurrent = selectedLeague?.categories.some((category) => category.id === current)
      if (hasCurrent) return current
      return firstLeague.categories[0]?.id ?? ''
    })
  }, [leagues, selectedLeague?.categories])

  useEffect(() => {
    if (!fixtureQuery.data) return
    const firstRound = fixtureQuery.data.fixture.rounds[0]?.round ?? 1
    const availableRounds = fixtureQuery.data.fixture.rounds.map((item) => item.round)
    setSelectedRound((current) => (availableRounds.includes(current) ? current : firstRound))
    setSelectedMatchId('')
  }, [fixtureQuery.data?.category.id, fixtureQuery.data?.league.id])

  const teamsMap = useMemo(() => {
    const map = new Map<string, string>()
    fixtureQuery.data?.teams.forEach((team) => {
      map.set(team.id, team.name)
    })
    return map
  }, [fixtureQuery.data?.teams])

  const teamsById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof fixtureQuery.data>['teams'][number]>()
    fixtureQuery.data?.teams.forEach((team) => {
      map.set(team.id, team)
    })
    return map
  }, [fixtureQuery.data?.teams])
  
  const playedMatchesById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof fixtureQuery.data>['playedMatches'][number]>()
    fixtureQuery.data?.playedMatches.forEach((match) => {
      map.set(match.matchId, match)
    })
    return map
  }, [fixtureQuery.data?.playedMatches])
  
  const getMatchDateTime = useCallback(
    (match: ScheduledMatch) => {
      if (match.scheduledAt) {
        const scheduled = new Date(match.scheduledAt).getTime()
        if (Number.isFinite(scheduled)) return scheduled
      }
  
      const played = playedMatchesById.get(match.id)?.playedAt
      if (played) {
        const playedTime = new Date(played).getTime()
        if (Number.isFinite(playedTime)) return playedTime
      }
  
      return Number.POSITIVE_INFINITY
    },
    [playedMatchesById],
  )

  const matches = useMemo(() => {
    const fixture = fixtureQuery.data
    if (!fixture) return [] as ScheduledMatch[]

    const playedMatchIdsSet = new Set(fixture.playedMatchIds)
    const result: ScheduledMatch[] = []
    const teamsByNormalizedName = new Map<string, string>()
    fixture.teams.forEach((team) => {
      buildTeamNameAliases(team.name).forEach((alias) => {
        if (!teamsByNormalizedName.has(alias)) {
          teamsByNormalizedName.set(alias, team.id)
        }
      })
    })
    const seenKeys = new Set<string>()

    // Mapas de lookup para la hora programada: por matchId y por clave round:home:away
    const scheduleAtById = new Map<string, string | undefined>()
    const scheduleAtByKey = new Map<string, string | undefined>()
    fixture.schedule.forEach((entry) => {
      scheduleAtById.set(entry.matchId, entry.scheduledAt)
      const p = parseMatchIdentity(entry.matchId, entry.round)
      if (p) {
        scheduleAtByKey.set(buildRoundTeamsKey(entry.round, p.homeTeamId, p.awayTeamId), entry.scheduledAt)
        scheduleAtByKey.set(buildRoundTeamsKey(entry.round, p.awayTeamId, p.homeTeamId), entry.scheduledAt)
      }
    })

    const resolveScheduledAt = (matchId: string, key: string, reverseKey: string, fallback?: string) =>
      scheduleAtById.get(matchId) ?? scheduleAtByKey.get(key) ?? scheduleAtByKey.get(reverseKey) ?? fallback

    // Construir matches desde schedule
    fixture.schedule.forEach((scheduleEntry) => {
      const parsed = parseMatchIdentity(scheduleEntry.matchId, scheduleEntry.round)
      if (!parsed) return

      const key = buildRoundTeamsKey(scheduleEntry.round, parsed.homeTeamId, parsed.awayTeamId)
      if (seenKeys.has(key)) return
      seenKeys.add(key)

      const isPlayed = playedMatchIdsSet.has(scheduleEntry.matchId)

      result.push({
        id: scheduleEntry.matchId,
        round: scheduleEntry.round,
        homeTeamId: parsed.homeTeamId,
        awayTeamId: parsed.awayTeamId,
        played: isPlayed,
        scheduledAt: scheduleEntry.scheduledAt,
        venue: scheduleEntry.venue,
        status: scheduleEntry.status,
      })
    })

    // Si existe un partido jugado que por desalineación no quedó en schedule,
    // se agrega para evitar que desaparezca en la fecha correspondiente.
    fixture.playedMatches.forEach((played) => {
      const parsed = parseMatchIdentity(played.matchId, played.round)

      if (parsed) {
        const key = buildRoundTeamsKey(played.round, parsed.homeTeamId, parsed.awayTeamId)
        if (seenKeys.has(key)) return
        seenKeys.add(key)

        const reverseKey = buildRoundTeamsKey(played.round, parsed.awayTeamId, parsed.homeTeamId)
        result.push({
          id: played.matchId,
          round: played.round,
          homeTeamId: parsed.homeTeamId,
          awayTeamId: parsed.awayTeamId,
          played: true,
          // Prefer scheduled time; only fall back to playedAt if no schedule entry exists
          scheduledAt: resolveScheduledAt(played.matchId, key, reverseKey, played.playedAt),
        })
        return
      }

      const homeTeamId = buildTeamNameAliases(played.homeTeamName).map((alias) => teamsByNormalizedName.get(alias)).find(Boolean)
      const awayTeamId = buildTeamNameAliases(played.awayTeamName).map((alias) => teamsByNormalizedName.get(alias)).find(Boolean)
      if (!homeTeamId || !awayTeamId) return

      const key = buildRoundTeamsKey(played.round, homeTeamId, awayTeamId)
      if (seenKeys.has(key)) return
      seenKeys.add(key)

      const reverseKey = buildRoundTeamsKey(played.round, awayTeamId, homeTeamId)
      result.push({
        id: played.matchId,
        round: played.round,
        homeTeamId,
        awayTeamId,
        played: true,
        // Prefer scheduled time; only fall back to playedAt if no schedule entry exists
        scheduledAt: resolveScheduledAt(played.matchId, key, reverseKey, played.playedAt),
      })
    })

    // Ordenar por round y luego por fecha/hora ascendente.
    return result.sort((left, right) => {
      if (left.round !== right.round) return left.round - right.round
      const leftTime = getMatchDateTime(left)
      const rightTime = getMatchDateTime(right)
      if (leftTime !== rightTime) return leftTime - rightTime
      return left.id.localeCompare(right.id, 'es')
    })
  }, [fixtureQuery.data, getMatchDateTime])

  const matchesByRound = useMemo(
    () => matches.filter((match) => match.round === selectedRound),
    [matches, selectedRound],
  )

  const selectedRoundAward = useMemo(() => {
    const roundAwards = fixtureQuery.data?.roundAwards ?? []
    return roundAwards.find((item) => item.round === selectedRound) ?? null
  }, [fixtureQuery.data?.roundAwards, selectedRound])

  const topRoundAwardLeaders = useMemo(() => {
    const roundAwards = fixtureQuery.data?.roundAwards ?? []
    const aggregate = new Map<
      string,
      {
        playerId: string
        playerName: string
        teamName?: string
        photoUrl?: string
        votes: number
      }
    >()

    roundAwards.forEach((item) => {
      if (!item.roundBestPlayerId || !item.roundBestPlayerName) return
      const current = aggregate.get(item.roundBestPlayerId) ?? {
        playerId: item.roundBestPlayerId,
        playerName: item.roundBestPlayerName,
        teamName: item.roundBestPlayerTeamName,
        photoUrl: item.roundBestPlayerPhotoUrl,
        votes: 0,
      }

      current.votes += 1
      if (!current.teamName && item.roundBestPlayerTeamName) current.teamName = item.roundBestPlayerTeamName
      if (!current.photoUrl && item.roundBestPlayerPhotoUrl) current.photoUrl = item.roundBestPlayerPhotoUrl

      aggregate.set(item.roundBestPlayerId, current)
    })

    return Array.from(aggregate.values())
      .sort((a, b) => b.votes - a.votes || a.playerName.localeCompare(b.playerName, 'es'))
      .slice(0, 3)
  }, [fixtureQuery.data?.roundAwards])

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? null,
    [matches, selectedMatchId],
  )

  const followedMatch = useMemo(
    () => matches.find((match) => match.id === followedMatchId) ?? null,
    [matches, followedMatchId],
  )

  useEffect(() => {
    if (followedMatchId && !followedMatch) {
      setFollowedMatchId('')
    }
  }, [followedMatch, followedMatchId])

  useEffect(() => {
    if (!followedMatchId) return

    void (async () => {
      const permission = await Notifications.getPermissionsAsync()
      const hasPermission = permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
      if (hasPermission) {
        setNotificationsEnabled(true)
        return
      }

      const requested = await Notifications.requestPermissionsAsync()
      const granted = requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
      setNotificationsEnabled(granted)
    })()
  }, [followedMatchId])

  const notifiedGoalEventIds = useMemo(() => new Set<string>(), [])

  useEffect(() => {
    if (!notificationsEnabled || !followedMatch || !liveMatch) return

    const sameOrder =
      liveMatch.homeTeam.id === followedMatch.homeTeamId && liveMatch.awayTeam.id === followedMatch.awayTeamId
    const swappedOrder =
      liveMatch.homeTeam.id === followedMatch.awayTeamId && liveMatch.awayTeam.id === followedMatch.homeTeamId

    if (!sameOrder && !swappedOrder) return

    liveMatch.events.forEach((event) => {
      if (event.type !== 'goal' && event.type !== 'penalty_goal') return
      if (notifiedGoalEventIds.has(event.id)) return

      notifiedGoalEventIds.add(event.id)

      const teamName = event.teamId === liveMatch.homeTeam.id ? liveMatch.homeTeam.name : liveMatch.awayTeam.name
      const minute = Number.isFinite(event.minute) ? `${event.minute}'` : event.clock
      void Notifications.scheduleNotificationAsync({
        content: {
          title: `Gol en ${liveMatch.homeTeam.name} vs ${liveMatch.awayTeam.name}`,
          body: `${teamName} anotó al ${minute}`,
        },
        trigger: null,
      })
    })
  }, [followedMatch, liveMatch, notificationsEnabled, notifiedGoalEventIds])

  const liveForSelected = useMemo(() => {
    if (!liveMatch || !selectedMatch) return null

    const sameOrder =
      liveMatch.homeTeam.id === selectedMatch.homeTeamId && liveMatch.awayTeam.id === selectedMatch.awayTeamId
    const swappedOrder =
      liveMatch.homeTeam.id === selectedMatch.awayTeamId && liveMatch.awayTeam.id === selectedMatch.homeTeamId

    return sameOrder || swappedOrder ? liveMatch : null
  }, [liveMatch, selectedMatch])

  const playedRecord = useMemo(() => {
    if (!fixtureQuery.data || !selectedMatch) return null

    const selectedKey = buildRoundTeamsKey(selectedMatch.round, selectedMatch.homeTeamId, selectedMatch.awayTeamId)
    const selectedReverseKey = buildRoundTeamsKey(selectedMatch.round, selectedMatch.awayTeamId, selectedMatch.homeTeamId)

    return (
      fixtureQuery.data.playedMatches.find((record) => {
        if (record.matchId === selectedMatch.id) return true
        const parsed = parseMatchIdentity(record.matchId, record.round)
        if (!parsed) return false
        const recordKey = buildRoundTeamsKey(record.round, parsed.homeTeamId, parsed.awayTeamId)
        return recordKey === selectedKey || recordKey === selectedReverseKey
      }) ?? null
    )
  }, [fixtureQuery.data, selectedMatch])

  const timelineEvents = useMemo(() => {
    if (liveForSelected) {
      return liveForSelected.events.slice().reverse().map((event) => {
        const team =
          event.teamId === liveForSelected.homeTeam.id ? liveForSelected.homeTeam : liveForSelected.awayTeam
        const outName = event.playerId
          ? team.players.find((player) => player.id === event.playerId)?.name ?? 'Sin jugadora'
          : 'Sin jugadora'
        const inName = event.substitutionInPlayerId
          ? team.players.find((player) => player.id === event.substitutionInPlayerId)?.name ?? ''
          : ''

        const actor = event.type === 'substitution' && inName ? `${outName} ↘ · ${inName} ↗` : outName

        return {
          id: event.id,
          text: `${event.clock} · ${team.name} · ${eventLabel[event.type]} · ${actor}`,
        }
      })
    }

    if (!playedRecord) return [] as Array<{ id: string; text: string }>

    return playedRecord.events.slice().reverse().map((event, index) => ({
      id: `history-${index}`,
      text: `${event.clock} · ${event.teamName} · ${eventLabel[event.type]} · ${event.playerName}`,
    }))
  }, [liveForSelected, playedRecord])

  const goalsTable = useMemo(() => {
    if (liveForSelected) {
      return liveForSelected.events
        .slice()
        .reverse()
        .filter((event) => event.type === 'goal' || event.type === 'penalty_goal')
        .map((event) => {
          const team =
            event.teamId === liveForSelected.homeTeam.id ? liveForSelected.homeTeam : liveForSelected.awayTeam
          const playerName = event.playerId
            ? liveForSelected.homeTeam.players.find((player) => player.id === event.playerId)?.name ??
              liveForSelected.awayTeam.players.find((player) => player.id === event.playerId)?.name ??
              'Sin jugadora'
            : 'Sin jugadora'

          return {
            id: event.id,
            minute: `${event.minute}'`,
            teamName: team.name,
            playerName,
            type: event.type === 'penalty_goal' ? 'Penal' : 'Juego',
          }
        })
    }

    if (!playedRecord) return [] as Array<{ id: string; minute: string; teamName: string; playerName: string; type: string }>

    return playedRecord.events
      .filter((event) => event.type === 'goal' || event.type === 'penalty_goal')
      .map((event, index) => ({
        id: `goal-${index}`,
        minute: `${Number(event.clock.split(':')[0] ?? '0')}'`,
        teamName: event.teamName,
        playerName: event.playerName,
        type: event.type === 'penalty_goal' ? 'Penal' : 'Juego',
      }))
  }, [liveForSelected, playedRecord])

  const highlightVideos = playedRecord?.highlightVideos ?? []
  const selectedMatchIsPlayed = Boolean(selectedMatch && selectedMatch.played)
  const selectedMatchIsLive = Boolean(liveForSelected)
  const scoreLine = selectedMatchIsLive
    ? `${liveForSelected?.homeTeam.stats.goals ?? 0} - ${liveForSelected?.awayTeam.stats.goals ?? 0}`
    : selectedMatchIsPlayed
      ? `${playedRecord?.homeGoals ?? 0} - ${playedRecord?.awayGoals ?? 0}`
      : '0 - 0'

  const playedEventStats = useMemo(() => {
    if (!playedRecord) return new Map<string, { goals: number; yellows: number; reds: number }>()

    const map = new Map<string, { goals: number; yellows: number; reds: number }>()
    playedRecord.events.forEach((event) => {
      if (!event.playerName) return
      const key = normalizePlayerKey(event.playerName)
      const current = map.get(key) ?? { goals: 0, yellows: 0, reds: 0 }

      if (event.type === 'goal' || event.type === 'penalty_goal') current.goals += 1
      if (event.type === 'yellow' || event.type === 'double_yellow') current.yellows += 1
      if (event.type === 'red') current.reds += 1

      map.set(key, current)
    })

    return map
  }, [playedRecord])

  const pitchLines = useMemo(() => {
    if (!selectedMatchIsPlayed || !playedRecord) return { home: [] as Array<Array<{ id: string; name: string; number: number }>>, away: [] as Array<Array<{ id: string; name: string; number: number }>> }

    const homeTeam = teamsById.get(selectedMatch?.homeTeamId ?? '')
    const awayTeam = teamsById.get(selectedMatch?.awayTeamId ?? '')
    if (!homeTeam || !awayTeam) return { home: [], away: [] }

    const resolveLineupPlayers = (
      teamPlayers: typeof homeTeam.players,
      lineup?: { starters: string[]; substitutes: string[]; formationKey?: string },
    ) => {
      const starters = (lineup?.starters ?? [])
        .map((playerId) => teamPlayers.find((player) => player.id === playerId))
        .filter((player): player is (typeof teamPlayers)[number] => Boolean(player))

      const basePlayers = starters.length > 0 ? starters : teamPlayers.slice(0, 7)
      return buildVisualLines(basePlayers, lineup?.formationKey)
    }

    return {
      home: resolveLineupPlayers(homeTeam.players, playedRecord.homeLineup),
      away: resolveLineupPlayers(awayTeam.players, playedRecord.awayLineup),
    }
  }, [playedRecord, selectedMatch?.awayTeamId, selectedMatch?.homeTeamId, selectedMatchIsPlayed, teamsById])

  const playerRankings = useMemo(() => {
    const fixture = fixtureQuery.data
    if (!fixture) return { scorers: [], assists: [], yellows: [], reds: [], goalkeepers: [] as GoalkeeperRanking[] }

    const playersMap = new Map<string, PlayerRanking>()

    fixture.playedMatches.forEach((match) => {
      const homeTeam = fixture.teams.find((team) => team.name === match.homeTeamName)
      const awayTeam = fixture.teams.find((team) => team.name === match.awayTeamName)

      match.events.forEach((event) => {
        if (!event.playerName || event.type === 'staff_yellow' || event.type === 'staff_red') return

        const isHomeTeam = event.teamName === match.homeTeamName
        const team = isHomeTeam ? homeTeam : awayTeam
        const player = team?.players.find((p) => normalizePlayerKey(p.name) === normalizePlayerKey(event.playerName))

        if (!player || !team) return

        const current = playersMap.get(player.id) ?? {
          playerId: player.id,
          playerName: player.name,
          playerNumber: player.number,
          teamId: team.id,
          teamName: team.name,
          teamLogoUrl: team.logoUrl,
          position: player.position,
          matches: 0,
          goals: 0,
          assists: 0,
          yellows: 0,
          reds: 0,
        }

        if (event.type === 'goal' || event.type === 'penalty_goal') current.goals += 1
        if (event.type === 'assist') current.assists += 1
        if (event.type === 'yellow' || event.type === 'double_yellow') current.yellows += 1
        if (event.type === 'red') current.reds += 1

        playersMap.set(player.id, current)
      })
    })

    const players = Array.from(playersMap.values())
    const sortByMetric = (metric: 'goals' | 'assists' | 'yellows' | 'reds') =>
      [...players]
        .filter((player) => player[metric] > 0)
        .sort((a, b) => b[metric] - a[metric] || a.playerName.localeCompare(b.playerName, 'es'))

    const goalkeepersByTeam = new Map(
      fixture.teams.map((team) => {
        const goalkeeper =
          team.players.find((player) => {
            const position = normalizePlayerKey(player.position)
            return (
              position.includes('arquera') ||
              position.includes('portera') ||
              position.includes('goalkeeper') ||
              position.includes('keeper') ||
              position.includes('gk')
            )
          }) ?? team.players[0]
        return [team.id, goalkeeper]
      }),
    )

    const goalkeepersMap = new Map<string, GoalkeeperRanking>()
    fixture.playedMatches.forEach((match) => {
      const homeTeam = fixture.teams.find((team) => team.name === match.homeTeamName)
      const awayTeam = fixture.teams.find((team) => team.name === match.awayTeamName)
      if (!homeTeam || !awayTeam) return

      const homeKeeper = goalkeepersByTeam.get(homeTeam.id)
      const awayKeeper = goalkeepersByTeam.get(awayTeam.id)

      if (homeKeeper) {
        const current = goalkeepersMap.get(homeKeeper.id) ?? {
          playerId: homeKeeper.id,
          playerName: homeKeeper.name,
          playerNumber: homeKeeper.number,
          teamId: homeTeam.id,
          teamName: homeTeam.name,
          matches: 0,
          cleanSheets: 0,
          goalsConceded: 0,
        }
        current.matches += 1
        current.goalsConceded += match.awayGoals
        if (match.awayGoals === 0) current.cleanSheets += 1
        goalkeepersMap.set(homeKeeper.id, current)
      }

      if (awayKeeper) {
        const current = goalkeepersMap.get(awayKeeper.id) ?? {
          playerId: awayKeeper.id,
          playerName: awayKeeper.name,
          playerNumber: awayKeeper.number,
          teamId: awayTeam.id,
          teamName: awayTeam.name,
          matches: 0,
          cleanSheets: 0,
          goalsConceded: 0,
        }
        current.matches += 1
        current.goalsConceded += match.homeGoals
        if (match.homeGoals === 0) current.cleanSheets += 1
        goalkeepersMap.set(awayKeeper.id, current)
      }
    })

    const goalkeepers = Array.from(goalkeepersMap.values()).sort(
      (a, b) =>
        b.cleanSheets - a.cleanSheets ||
        a.goalsConceded - b.goalsConceded ||
        b.matches - a.matches ||
        a.playerName.localeCompare(b.playerName, 'es'),
    )

    return {
      scorers: sortByMetric('goals'),
      assists: sortByMetric('assists'),
      yellows: sortByMetric('yellows'),
      reds: sortByMetric('reds'),
      goalkeepers,
    }
  }, [fixtureQuery.data])

  const standings = useMemo(() => {
    const fixture = fixtureQuery.data
    if (!fixture) return [] as StandingsRow[]

    const table = new Map<string, StandingsRow>()

    fixture.teams.forEach((team) => {
      table.set(team.id, {
        teamId: team.id,
        teamName: team.name,
        teamLogoUrl: team.logoUrl,
        pj: 0,
        pg: 0,
        pe: 0,
        pp: 0,
        gf: 0,
        gc: 0,
        dg: 0,
        pts: 0,
      })
    })

    const playedMatches = matches.filter((match) => match.played)

    playedMatches.forEach((match) => {
      const record = fixture.playedMatches.find((r) => r.matchId === match.id)
      if (!record) return

      const home = table.get(match.homeTeamId)
      const away = table.get(match.awayTeamId)
      if (!home || !away) return

      home.pj += 1
      away.pj += 1
      home.gf += record.homeGoals
      home.gc += record.awayGoals
      away.gf += record.awayGoals
      away.gc += record.homeGoals

      if (record.homeGoals > record.awayGoals) {
        home.pg += 1
        home.pts += 3
        away.pp += 1
      } else if (record.homeGoals < record.awayGoals) {
        away.pg += 1
        away.pts += 3
        home.pp += 1
      } else {
        home.pe += 1
        away.pe += 1
        home.pts += 1
        away.pts += 1
      }

      home.dg = home.gf - home.gc
      away.dg = away.gf - away.gc
    })

    return Array.from(table.values()).sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf || a.teamName.localeCompare(b.teamName, 'es'))
  }, [fixtureQuery.data, matches])

  const leagueThemeColor = fixtureQuery.data?.league.themeColor ?? selectedLeague?.themeColor ?? '#0ea5e9'
  const themeHex = normalizeHexColor(leagueThemeColor) ?? '#0ea5e9'
  const contrastTextColor = getContrastColor(themeHex)
  const accentColor = getAccentColor(themeHex)
  const isThemeLight = contrastTextColor === '#0f172a'
  const activeSurfaceColor = isThemeLight ? '#f8fafc' : '#0f172a'
  const activeTextColor = getContrastColor(activeSurfaceColor)
  const secondaryTextColor = isThemeLight ? '#334155' : '#cbd5e1'
  const themedChipActiveStyle = {
    backgroundColor: activeSurfaceColor,
    borderColor: withAlpha(themeHex, 'FF'),
  }
  const themedTabActiveStyle = {
    backgroundColor: activeSurfaceColor,
    borderColor: withAlpha(themeHex, 'FF'),
  }
  const themedBackButtonStyle = {
    borderColor: withAlpha(themeHex, 'F0'),
    backgroundColor: activeSurfaceColor,
  }
  const themedMatchCardStyle = {
    borderColor: withAlpha(themeHex, isThemeLight ? '9C' : '7A'),
    backgroundColor: withAlpha(themeHex, isThemeLight ? '24' : '16'),
    shadowColor: '#020617',
    shadowOpacity: isThemeLight ? 0.12 : 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  }
  const themedSectionTitleStyle = {
    color: accentColor,
  }
  const themedHeroTitleStyle = {
    color: contrastTextColor,
  }
  const themedHeroSubtitleStyle = {
    color: secondaryTextColor,
  }
  const themedMvpCardStyle = {
    backgroundColor: '#0b1120',
    borderColor: '#334155',
  }
  const mvpTitleColor = '#fef08a'
  const mvpPrimaryTextColor = '#ffffff'
  const mvpSecondaryTextColor = '#cbd5e1'
  const themedStatusBarStyle = isThemeLight ? 'dark' : 'light'
  const leagueBackgroundImageUrl = fixtureQuery.data?.league.backgroundImageUrl ?? selectedLeague?.backgroundImageUrl
  const leagueLogoUrl = fixtureQuery.data?.league.logoUrl ?? selectedLeague?.logoUrl
  const heroLogoSource = leagueLogoUrl ? { uri: leagueLogoUrl } : { uri: webLogoUri }
  const year = new Date().getFullYear()
  const leagueName = fixtureQuery.data?.league.name ?? selectedLeague?.name ?? 'FL Liga Mobile'
  const leagueSubtitle = selectedClient?.organizationName
    ? `${selectedClient.organizationName} · ${activeCategory?.name ?? 'Categorías'}`
    : `${selectedClient?.name ?? 'Multicliente'} · ${activeCategory?.name ?? 'Categorías'}`

  const handleBack = () => {
    if (step === 'match') {
      setStep('matches')
      return
    }

    if (step === 'matches') {
      setSelectedLeagueId('')
      setSelectedCategoryId('')
      setStep('league')
      return
    }

    if (step === 'league') {
      setSelectedLeagueId('')
      setSelectedCategoryId('')
      setStep('company')
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: '#f8fafc' }]}> 
      <StatusBar style={themedStatusBarStyle} />
      <View style={styles.container}>
        <View style={styles.topRow}>{step !== 'company' && <Pressable style={[styles.backButton, themedBackButtonStyle]} onPress={handleBack}><Text style={[styles.backButtonText, { color: activeTextColor }]}>← Volver</Text></Pressable>}</View>

        {followedMatch && (
          <View style={styles.followedMatchBar}>
            <Text style={styles.followedMatchBarText} numberOfLines={1}>
              Siguiendo: {teamsMap.get(followedMatch.homeTeamId) ?? 'Local'} vs {teamsMap.get(followedMatch.awayTeamId) ?? 'Visitante'}
            </Text>
            <Text style={styles.followedMatchBarHint}>
              {notificationsEnabled ? 'Notificaciones de gol activas' : 'Activa permisos para notificaciones'}
            </Text>
          </View>
        )}

        <View
          style={[
            styles.hero,
            {
              backgroundColor: withAlpha(themeHex, '1F'),
              borderColor: withAlpha(themeHex, 'A0'),
            },
          ]}
        >
          {leagueBackgroundImageUrl && <Image source={{ uri: leagueBackgroundImageUrl }} style={styles.heroBackgroundImage} />}
          <View style={styles.heroTextBox}>
            <Text style={[styles.heroOverline, { color: accentColor }]}>FL Liga · Mobile Live</Text>
            <Text style={[styles.title, themedHeroTitleStyle]}>{leagueName}</Text>
            <Text style={[styles.subtitle, themedHeroSubtitleStyle]}>{leagueSubtitle}</Text>
          </View>
          <Image source={heroLogoSource} defaultSource={defaultFLLogo} style={styles.heroLogo} />
        </View>

        {clientsQuery.isLoading && <ActivityIndicator color="#38bdf8" />}
        {clientsQuery.isError && <Text style={styles.error}>No se pudieron cargar clientes desde Render/Mongo.</Text>}

        {step === 'company' && (
          <>
            <Text style={[styles.sectionTitle, themedSectionTitleStyle]}>1) Elige la empresa</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
              {(clientsQuery.data ?? []).map((client) => (
                <Pressable
                  key={client.id}
                  style={[styles.chip, selectedClientId === client.id && styles.chipActive, selectedClientId === client.id && themedChipActiveStyle]}
                  onPress={() => {
                    setSelectedClientId(client.id)
                    setSelectedLeagueId('')
                    setSelectedCategoryId('')
                    setSelectedRound(1)
                    setSelectedMatchId('')
                    setStep('league')
                  }}
                >
                    <Text style={[styles.chipText, selectedClientId === client.id && { color: activeTextColor }]}>
                    {client.organizationName ?? client.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {step === 'league' && selectedClient && (
          <>
            <Text style={[styles.sectionTitle, themedSectionTitleStyle]}>2) Elige la liga del cliente</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
              {leagues.map((league) => (
                <Pressable
                  key={league.id}
                  style={[styles.chip, selectedLeagueId === league.id && styles.chipActive, selectedLeagueId === league.id && themedChipActiveStyle]}
                  onPress={() => {
                    setSelectedLeagueId(league.id)
                    setSelectedCategoryId(league.categories[0]?.id ?? '')
                    setSelectedRound(1)
                    setSelectedMatchId('')
                    setStep('matches')
                  }}
                >
                    <Text style={[styles.chipText, selectedLeagueId === league.id && { color: activeTextColor }]}>{league.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {leagues.length === 0 && <Text style={styles.empty}>Este cliente no tiene ligas públicas activas.</Text>}
          </>
        )}

        {step === 'matches' && fixtureQuery.isLoading && <ActivityIndicator color="#22d3ee" />}
        {step === 'matches' && fixtureQuery.isError && (
          <Text style={styles.error}>No se pudo cargar fixture desde backend de Render/Mongo.</Text>
        )}

        {step === 'matches' && fixtureQuery.data && (
          <>
            <View style={styles.tabsRow}>
              <Pressable
                style={[styles.tab, activeLeagueTab === 'matches' && styles.tabActive, activeLeagueTab === 'matches' && themedTabActiveStyle]}
                onPress={() => setActiveLeagueTab('matches')}
              >
                  <Text style={[styles.tabText, activeLeagueTab === 'matches' && { color: activeTextColor }]}>Partidos</Text>
              </Pressable>
              <Pressable
                style={[styles.tab, activeLeagueTab === 'overview' && styles.tabActive, activeLeagueTab === 'overview' && themedTabActiveStyle]}
                onPress={() => setActiveLeagueTab('overview')}
              >
                  <Text style={[styles.tabText, activeLeagueTab === 'overview' && { color: activeTextColor }]}>Resumen</Text>
              </Pressable>
            </View>

            {activeLeagueTab === 'matches' ? (
              <>
                <View style={styles.inlineSelectorRow}>
                  <Text style={[styles.inlineSelectorLabel, themedSectionTitleStyle]}>Cat.</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                    {categories.map((category) => (
                      <Pressable
                        key={category.id}
                        style={[styles.chip, activeCategory?.id === category.id && styles.chipActive, activeCategory?.id === category.id && themedChipActiveStyle]}
                        onPress={() => {
                          setSelectedCategoryId(category.id)
                          setSelectedRound(1)
                          setSelectedMatchId('')
                        }}
                      >
                        <Text style={[styles.chipText, activeCategory?.id === category.id && { color: activeTextColor }]}>
                          {category.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.inlineSelectorRow}>
                  <Text style={[styles.inlineSelectorLabel, themedSectionTitleStyle]}>Fecha</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                  {fixtureQuery.data.fixture.rounds.map((round) => (
                    <Pressable
                      key={round.round}
                      style={[styles.chip, selectedRound === round.round && styles.chipActive, selectedRound === round.round && themedChipActiveStyle]}
                      onPress={() => {
                        setSelectedRound(round.round)
                        setSelectedMatchId('')
                      }}
                    >
                        <Text style={[styles.chipText, selectedRound === round.round && { color: activeTextColor }]}>
                        Fecha {round.round}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                </View>

                {selectedRoundAward && (() => {
                  const mvpTeam = selectedRoundAward.roundBestPlayerTeamId
                    ? fixtureQuery.data?.teams.find((team) => team.id === selectedRoundAward.roundBestPlayerTeamId)
                    : undefined
                  const mvpTeamColor = mvpTeam ? getTeamColor(mvpTeam) : '#3b82f6'
                  const mvpTextColor = getContrastColor(mvpTeamColor)
                  const mvpSecondary = mvpTextColor === '#ffffff' ? '#cbd5e1' : '#64748b'
                  return (
                    <View style={[styles.roundAwardCard, { backgroundColor: mvpTeamColor, borderColor: mvpTextColor }]}>
                      <Text style={[styles.roundAwardTitle, { color: mvpTextColor }]}>Jugadora de la Fecha {selectedRound}</Text>
                      <View style={styles.roundAwardRow}>
                        {selectedRoundAward.roundBestPlayerPhotoUrl ? (
                          <Image source={{ uri: selectedRoundAward.roundBestPlayerPhotoUrl }} style={styles.roundAwardPhoto} />
                        ) : (
                          <View style={styles.roundAwardPhotoFallback}>
                            <Text style={styles.roundAwardPhotoFallbackText}>JF</Text>
                          </View>
                        )}
                        <View style={styles.roundAwardMeta}>
                          <Text style={[styles.roundAwardName, { color: mvpTextColor }]}>{selectedRoundAward.roundBestPlayerName ?? 'Por definir'}</Text>
                          <Text style={[styles.roundAwardTeam, { color: mvpTextColor }]}>{selectedRoundAward.roundBestPlayerTeamName ?? 'Equipo por definir'}</Text>
                        </View>
                      </View>
                    </View>
                  )
                })()}

                <Text style={[styles.sectionTitle, themedSectionTitleStyle]}>Partidos (jugados y por jugar)</Text>
                <FlatList
                  data={matchesByRound}
                  keyExtractor={(item) => item.id}
                  style={styles.matchList}
                  renderItem={({ item }) => {
                    const homeTeam = teamsById.get(item.homeTeamId)
                    const awayTeam = teamsById.get(item.awayTeamId)
                    const homeName = homeTeam?.name ?? 'Local'
                    const awayName = awayTeam?.name ?? 'Visita'

                    // Detectar partido en vivo
                    const isLiveDirect = Boolean(liveMatch && liveMatch.homeTeam.id === item.homeTeamId && liveMatch.awayTeam.id === item.awayTeamId)
                    const isLiveReverse = Boolean(liveMatch && liveMatch.homeTeam.id === item.awayTeamId && liveMatch.awayTeam.id === item.homeTeamId)
                    const hasLiveRef = isLiveDirect || isLiveReverse
                    const liveElapsed = liveMatch?.timer?.elapsedSeconds ?? 0
                    const isBreak = hasLiveRef && liveMatch?.status === 'live' && !(liveMatch?.timer?.running ?? false) && liveElapsed > 0
                    const isLive = hasLiveRef && liveMatch?.status === 'live' && !isBreak
                    const isLiveFinished = hasLiveRef && liveMatch?.status === 'finished'
                    const isFinished = item.played || isLiveFinished

                    // Marcador
                    const histRecord = fixtureQuery.data.playedMatches.find((entry) => entry.matchId === item.id)
                    const liveHomeGoals = isLiveDirect ? (liveMatch?.homeTeam.stats.goals ?? 0) : (liveMatch?.awayTeam.stats.goals ?? 0)
                    const liveAwayGoals = isLiveDirect ? (liveMatch?.awayTeam.stats.goals ?? 0) : (liveMatch?.homeTeam.stats.goals ?? 0)
                    const showScore = isFinished || isLive || isBreak
                    const scoreHome = isFinished && !isLive ? (histRecord?.homeGoals ?? 0) : liveHomeGoals
                    const scoreAway = isFinished && !isLive ? (histRecord?.awayGoals ?? 0) : liveAwayGoals

                    // Hora programada (siempre desde scheduledAt, nunca playedAt)
                    const scheduledLabel = formatScheduleLabel(item.scheduledAt)

                    // Estado y estilos del badge
                    const isPostponed = !isLive && !isBreak && !isFinished && item.status === 'postponed'
                    const statusText = isLive ? 'En juego' : isBreak ? 'Descanso' : isFinished ? 'Finalizado' : isPostponed ? 'Postergado' : 'Por jugar'
                    const badgeStyle = isLive
                      ? styles.statusBadgeLive
                      : isBreak
                        ? styles.statusBadgeBreak
                        : isFinished
                          ? styles.statusBadgeFinished
                          : isPostponed
                            ? styles.statusBadgePostponed
                            : styles.statusBadgePending
                    const badgeTextStyle = isLive
                      ? styles.statusBadgeTextLive
                      : isBreak
                        ? styles.statusBadgeTextBreak
                        : isFinished
                          ? styles.statusBadgeTextFinished
                          : isPostponed
                            ? styles.statusBadgeTextPostponed
                            : styles.statusBadgeTextPending
                    const scoreBoxStyle = isLive ? styles.matchScoreBoxLive : isBreak ? styles.matchScoreBoxBreak : styles.matchScoreBoxFinished
                    const scoreLabelStyle = isLive ? styles.matchScoreLabelLive : isBreak ? styles.matchScoreLabelBreak : styles.matchScoreLabelFinished
                    const scoreTitle = isLive ? 'Marcador' : isBreak ? 'Al descanso' : 'Resultado final'

                    return (
                      <Pressable
                        style={[styles.matchCard, themedMatchCardStyle]}
                        onPress={() => {
                          setSelectedMatchId(item.id)
                          setActiveMatchTab('pitch')
                          setStep('match')
                        }}
                      >
                        <View style={styles.matchCardTopRow}>
                          <View style={styles.matchTeamsRow}>
                            <View style={styles.matchTeam}>
                              {homeTeam?.logoUrl && (
                                <Image source={{ uri: homeTeam.logoUrl }} style={styles.matchTeamLogo} />
                              )}
                              <Text style={[styles.matchTeamName, { color: contrastTextColor }]} numberOfLines={1}>{homeName}</Text>
                            </View>
                            <Text style={[styles.matchVs, { color: secondaryTextColor }]}>vs</Text>
                            <View style={[styles.matchTeam, { justifyContent: 'flex-end' }]}>
                              <Text style={[styles.matchTeamName, { color: contrastTextColor, textAlign: 'right' }]} numberOfLines={1}>{awayName}</Text>
                              {awayTeam?.logoUrl && (
                                <Image source={{ uri: awayTeam.logoUrl }} style={styles.matchTeamLogo} />
                              )}
                            </View>
                          </View>
                          <View style={[styles.statusBadge, badgeStyle]}>
                            {isLive && <View style={styles.livePulseDot} />}
                            <Text style={[styles.statusBadgeText, badgeTextStyle]}>{statusText}</Text>
                          </View>
                        </View>

                        {showScore && (
                          <View style={[styles.matchScoreBox, scoreBoxStyle]}>
                            <Text style={[styles.matchScoreLabel, scoreLabelStyle]}>{scoreTitle}: {scoreHome} – {scoreAway}</Text>
                          </View>
                        )}

                        {scheduledLabel && (
                          <Text style={[styles.matchMeta, { color: secondaryTextColor }]}>
                            {isFinished ? '🕐 ' : '📅 '}{scheduledLabel}
                          </Text>
                        )}
                        {item.venue ? <Text style={[styles.matchVenue, { color: secondaryTextColor }]}>{item.venue}</Text> : null}

                        <View style={styles.matchActionsRow}>
                          <Pressable
                            onPress={() => setFollowedMatchId((current) => (current === item.id ? '' : item.id))}
                            style={[styles.followMatchButton, followedMatchId === item.id && styles.followMatchButtonActive]}
                          >
                            <Text style={[styles.followMatchButtonText, followedMatchId === item.id && styles.followMatchButtonTextActive]}>
                              {followedMatchId === item.id ? 'Siguiendo' : 'Seguir partido'}
                            </Text>
                          </Pressable>
                        </View>
                      </Pressable>
                    )
                  }}
                  ListEmptyComponent={<Text style={styles.empty}>Sin partidos para esta fecha.</Text>}
                />
              </>
            ) : (
              <>
                <View style={styles.tabsRow}>
                  <Pressable style={[styles.tab, activeOverviewTab === 'standings' && styles.tabActive, activeOverviewTab === 'standings' && themedTabActiveStyle]} onPress={() => setActiveOverviewTab('standings')}>
                    <Text style={[styles.tabText, activeOverviewTab === 'standings' && { color: activeTextColor }]}>Posic.</Text>
                  </Pressable>
                  <Pressable style={[styles.tab, activeOverviewTab === 'scorers' && styles.tabActive, activeOverviewTab === 'scorers' && themedTabActiveStyle]} onPress={() => setActiveOverviewTab('scorers')}>
                    <Text style={[styles.tabText, activeOverviewTab === 'scorers' && { color: activeTextColor }]}>Goles</Text>
                  </Pressable>
                  <Pressable style={[styles.tab, activeOverviewTab === 'assists' && styles.tabActive, activeOverviewTab === 'assists' && themedTabActiveStyle]} onPress={() => setActiveOverviewTab('assists')}>
                    <Text style={[styles.tabText, activeOverviewTab === 'assists' && { color: activeTextColor }]}>Asist.</Text>
                  </Pressable>
                  <Pressable style={[styles.tab, activeOverviewTab === 'yellows' && styles.tabActive, activeOverviewTab === 'yellows' && themedTabActiveStyle]} onPress={() => setActiveOverviewTab('yellows')}>
                    <Text style={[styles.tabText, activeOverviewTab === 'yellows' && { color: activeTextColor }]}>TA</Text>
                  </Pressable>
                  <Pressable style={[styles.tab, activeOverviewTab === 'reds' && styles.tabActive, activeOverviewTab === 'reds' && themedTabActiveStyle]} onPress={() => setActiveOverviewTab('reds')}>
                    <Text style={[styles.tabText, activeOverviewTab === 'reds' && { color: activeTextColor }]}>TR</Text>
                  </Pressable>
                  <Pressable style={[styles.tab, activeOverviewTab === 'goalkeepers' && styles.tabActive, activeOverviewTab === 'goalkeepers' && themedTabActiveStyle]} onPress={() => setActiveOverviewTab('goalkeepers')}>
                    <Text style={[styles.tabText, activeOverviewTab === 'goalkeepers' && { color: activeTextColor }]}>ARQ</Text>
                  </Pressable>
                </View>

                {activeOverviewTab === 'standings' && (
                  <ScrollView style={styles.statsScroll}>
                    <Text style={[styles.sectionTitle, themedSectionTitleStyle]}>Tabla de Posiciones</Text>
                    {standings.length === 0 ? (
                      <Text style={styles.empty}>No hay partidos jugados aún.</Text>
                    ) : (
                      standings.map((team, index) => (
                        <View key={team.teamId} style={[styles.standingsRow, themedMatchCardStyle]}>
                          <Text style={[styles.standingsPosition, { color: contrastTextColor }]}>{index + 1}</Text>
                          {team.teamLogoUrl && (
                            <Image source={{ uri: team.teamLogoUrl }} style={styles.teamLogo} />
                          )}
                          <View style={styles.standingsTeam}>
                            <Text style={[styles.standingsTeamName, { color: contrastTextColor }]}>{team.teamName}</Text>
                            <Text style={[styles.standingsStats, { color: secondaryTextColor }]}>
                              PJ: {team.pj} · PG: {team.pg} · PE: {team.pe} · PP: {team.pp} · GF: {team.gf} · GC: {team.gc} · DG: {team.dg >= 0 ? '+' : ''}{team.dg}
                            </Text>
                          </View>
                          <Text style={[styles.standingsPoints, { color: contrastTextColor }]}>{team.pts}</Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                )}

                {activeOverviewTab === 'scorers' && (
                  <ScrollView style={styles.statsScroll}>
                    <Text style={[styles.sectionTitle, themedSectionTitleStyle]}>Goleadores</Text>
                    {playerRankings.scorers.length === 0 ? (
                      <Text style={styles.empty}>No hay goleadores registrados.</Text>
                    ) : (
                      playerRankings.scorers.map((player, index) => (
                        <View key={player.playerId} style={[styles.rankingRow, themedMatchCardStyle]}>
                          <Text style={[styles.rankingPosition, { color: contrastTextColor }]}>{index + 1}</Text>
                          <View style={styles.rankingInfo}>
                            <Text style={[styles.rankingName, { color: contrastTextColor }]}>{player.playerName} · #{player.playerNumber}</Text>
                            <Text style={[styles.rankingTeam, { color: secondaryTextColor }]}>{player.teamName}</Text>
                          </View>
                          <Text style={[styles.rankingValue, { color: contrastTextColor }]}>{player.goals} ⚽</Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                )}

                {activeOverviewTab === 'assists' && (
                  <ScrollView style={styles.statsScroll}>
                    <Text style={[styles.sectionTitle, themedSectionTitleStyle]}>Asistidores</Text>
                    {playerRankings.assists.length === 0 ? (
                      <Text style={styles.empty}>No hay asistidores registrados.</Text>
                    ) : (
                      playerRankings.assists.map((player, index) => (
                        <View key={player.playerId} style={[styles.rankingRow, themedMatchCardStyle]}>
                          <Text style={[styles.rankingPosition, { color: contrastTextColor }]}>{index + 1}</Text>
                          <View style={styles.rankingInfo}>
                            <Text style={[styles.rankingName, { color: contrastTextColor }]}>{player.playerName} · #{player.playerNumber}</Text>
                            <Text style={[styles.rankingTeam, { color: secondaryTextColor }]}>{player.teamName}</Text>
                          </View>
                          <Text style={[styles.rankingValue, { color: contrastTextColor }]}>{player.assists} 🅰️</Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                )}

                {activeOverviewTab === 'yellows' && (
                  <ScrollView style={styles.statsScroll}>
                    <Text style={[styles.sectionTitle, themedSectionTitleStyle]}>Tarjetas Amarillas</Text>
                    {playerRankings.yellows.length === 0 ? (
                      <Text style={styles.empty}>No hay tarjetas amarillas registradas.</Text>
                    ) : (
                      playerRankings.yellows.map((player, index) => (
                        <View key={player.playerId} style={[styles.rankingRow, themedMatchCardStyle]}>
                          <Text style={[styles.rankingPosition, { color: contrastTextColor }]}>{index + 1}</Text>
                          <View style={styles.rankingInfo}>
                            <Text style={[styles.rankingName, { color: contrastTextColor }]}>{player.playerName} · #{player.playerNumber}</Text>
                            <Text style={[styles.rankingTeam, { color: secondaryTextColor }]}>{player.teamName}</Text>
                          </View>
                          <Text style={[styles.rankingValue, { color: contrastTextColor }]}>{player.yellows} 🟨</Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                )}

                {activeOverviewTab === 'reds' && (
                  <ScrollView style={styles.statsScroll}>
                    <Text style={[styles.sectionTitle, themedSectionTitleStyle]}>Tarjetas Rojas</Text>
                    {playerRankings.reds.length === 0 ? (
                      <Text style={styles.empty}>No hay tarjetas rojas registradas.</Text>
                    ) : (
                      playerRankings.reds.map((player, index) => (
                        <View key={player.playerId} style={[styles.rankingRow, themedMatchCardStyle]}>
                          <Text style={[styles.rankingPosition, { color: contrastTextColor }]}>{index + 1}</Text>
                          <View style={styles.rankingInfo}>
                            <Text style={[styles.rankingName, { color: contrastTextColor }]}>{player.playerName} · #{player.playerNumber}</Text>
                            <Text style={[styles.rankingTeam, { color: secondaryTextColor }]}>{player.teamName}</Text>
                          </View>
                          <Text style={[styles.rankingValue, { color: contrastTextColor }]}>{player.reds} 🟥</Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                )}

                {activeOverviewTab === 'goalkeepers' && (
                  <ScrollView style={styles.statsScroll}>
                    <Text style={[styles.sectionTitle, themedSectionTitleStyle]}>Arqueras Destacadas</Text>
                    {playerRankings.goalkeepers.length === 0 ? (
                      <Text style={styles.empty}>No hay estadísticas de arqueras todavía.</Text>
                    ) : (
                      playerRankings.goalkeepers.map((goalkeeper, index) => (
                        <View key={goalkeeper.playerId} style={[styles.rankingRow, themedMatchCardStyle]}>
                          <Text style={[styles.rankingPosition, { color: contrastTextColor }]}>{index + 1}</Text>
                          <View style={styles.rankingInfo}>
                            <Text style={[styles.rankingName, { color: contrastTextColor }]}>{goalkeeper.playerName} · #{goalkeeper.playerNumber}</Text>
                            <Text style={[styles.rankingTeam, { color: secondaryTextColor }]}>{goalkeeper.teamName}</Text>
                            <Text style={[styles.rankingTeam, { color: secondaryTextColor }]}>PJ: {goalkeeper.matches} · GC: {goalkeeper.goalsConceded}</Text>
                          </View>
                          <Text style={[styles.rankingValue, { color: contrastTextColor }]}>{goalkeeper.cleanSheets} 🧤</Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                )}

                {topRoundAwardLeaders.length > 0 && (
                  <View style={[styles.mvpCard, themedMvpCardStyle, { marginTop: 12 }] }>
                    <Text style={[styles.mvpTitle, { color: mvpTitleColor }]}>Top 3 acumulado · Jugadora de la fecha</Text>
                    {topRoundAwardLeaders.map((leader, index) => (
                      <View key={leader.playerId} style={styles.topLeaderRow}>
                        <Text style={styles.topLeaderPosition}>{index + 1}.</Text>
                        {leader.photoUrl ? (
                          <Image source={{ uri: leader.photoUrl }} style={styles.topLeaderPhoto} />
                        ) : (
                          <View style={styles.topLeaderPhotoFallback}>
                            <Text style={styles.topLeaderPhotoFallbackText}>JF</Text>
                          </View>
                        )}
                        <View style={styles.topLeaderMeta}>
                          <Text style={[styles.topLeaderName, { color: mvpPrimaryTextColor }]}>{leader.playerName}</Text>
                          <Text style={[styles.topLeaderTeam, { color: mvpSecondaryTextColor }]}>{leader.teamName ?? 'Equipo por definir'}</Text>
                        </View>
                        <Text style={[styles.topLeaderVotes, { color: mvpPrimaryTextColor }]}>{leader.votes} voto{leader.votes === 1 ? '' : 's'}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}

        {step === 'match' && selectedMatch && (
          <View style={styles.detailCard}>
            <View style={styles.matchActionsRow}>
              <Pressable
                onPress={() => setFollowedMatchId((current) => (current === selectedMatch.id ? '' : selectedMatch.id))}
                style={[styles.followMatchButton, followedMatchId === selectedMatch.id && styles.followMatchButtonActive]}
              >
                <Text style={[styles.followMatchButtonText, followedMatchId === selectedMatch.id && styles.followMatchButtonTextActive]}>
                  {followedMatchId === selectedMatch.id ? 'Siguiendo partido' : 'Seguir partido'}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.detailTitle, { color: accentColor }]}>
              {selectedMatchIsLive ? 'Partido en vivo' : selectedMatchIsPlayed ? 'Partido finalizado' : 'Partido programado'}
            </Text>
            <Text style={[styles.score, { color: contrastTextColor }]}>{scoreLine}</Text>
            <Text style={[styles.detailMeta, { color: secondaryTextColor }]}>
              {teamsMap.get(selectedMatch.homeTeamId)} vs {teamsMap.get(selectedMatch.awayTeamId)}
            </Text>

            {selectedMatchIsPlayed && playedRecord?.playerOfMatchName && (() => {
              const mvpTeam = fixtureQuery.data?.teams.find((team) => team.name === playedRecord.playerOfMatchTeamName)
              const mvpTeamColor = mvpTeam ? getTeamColor(mvpTeam) : '#3b82f6'
              const mvpTextColor = getContrastColor(mvpTeamColor)
              const mvpSecondary = mvpTextColor === '#ffffff' ? '#cbd5e1' : '#64748b'
              return (
                <View style={[styles.mvpCard, { backgroundColor: mvpTeamColor, borderColor: mvpTextColor }]}>
                  <Text style={[styles.mvpTitle, { color: mvpTextColor }]}>⭐ MVP del partido</Text>
                  <Text style={[styles.mvpName, { color: mvpTextColor }]}>{playedRecord.playerOfMatchName}</Text>
                  {playedRecord.playerOfMatchTeamName && (
                    <Text style={[styles.mvpTeam, { color: mvpTextColor }]}>{playedRecord.playerOfMatchTeamName}</Text>
                  )}
                </View>
              )
            })()}

            <View style={styles.tabsRow}>
              <Pressable
                style={[styles.tab, activeMatchTab === 'pitch' && styles.tabActive, activeMatchTab === 'pitch' && themedTabActiveStyle]}
                onPress={() => setActiveMatchTab('pitch')}
              >
                  <Text style={[styles.tabText, activeMatchTab === 'pitch' && { color: activeTextColor }]}>Cancha</Text>
              </Pressable>
              <Pressable
                style={[styles.tab, activeMatchTab === 'events' && styles.tabActive, activeMatchTab === 'events' && themedTabActiveStyle]}
                onPress={() => setActiveMatchTab('events')}
              >
                  <Text style={[styles.tabText, activeMatchTab === 'events' && { color: activeTextColor }]}>Eventos</Text>
              </Pressable>
              {selectedMatchIsPlayed && (
                <Pressable
                  style={[styles.tab, activeMatchTab === 'highlights' && styles.tabActive, activeMatchTab === 'highlights' && themedTabActiveStyle]}
                  onPress={() => setActiveMatchTab('highlights')}
                >
                    <Text style={[styles.tabText, activeMatchTab === 'highlights' && { color: activeTextColor }]}>Highlights</Text>
                </Pressable>
              )}
            </View>

            {activeMatchTab === 'pitch' && (
              <View style={styles.pitchCard}>
                <View style={styles.pitchField}>
                  <View style={styles.pitchHalfLine} />
                  <View style={styles.pitchCenterCircle} />
                  <View style={styles.pitchBoxTop} />
                  <View style={styles.pitchBoxBottom} />

                  {(() => {
                    const homeTeam = fixtureQuery.data?.teams.find((team) => team.id === selectedMatch?.homeTeamId)
                    const awayTeam = fixtureQuery.data?.teams.find((team) => team.id === selectedMatch?.awayTeamId)
                    const teamColors = getMatchTeamColors(homeTeam, awayTeam)

                    return (
                      <>
                        {pitchLines.away.length > 0 && (
                          <View style={styles.pitchHalfTop}>
                            {pitchLines.away.map((line, lineIndex) => {
                              return (
                                <View key={`away-line-${lineIndex}`} style={styles.pitchLine}>
                                  {line.map((player) => {
                                    const stats = playedEventStats.get(normalizePlayerKey(player.name))
                                    return (
                                      <View key={player.id} style={styles.pitchPlayerWrap}>
                                        <View style={[styles.pitchPlayerAway, { backgroundColor: teamColors.away }]}>
                                          <Text style={styles.pitchPlayerNumber}>{player.number}</Text>
                                          {stats?.yellows ? <View style={styles.pitchCardYellow} /> : null}
                                          {stats?.reds ? <View style={styles.pitchCardRed} /> : null}
                                        </View>
                                        <Text numberOfLines={1} style={styles.pitchPlayerName}>{player.name}</Text>
                                        {stats && (stats.goals > 0 || stats.yellows > 0 || stats.reds > 0) && (
                                          <Text style={styles.pitchPlayerBadges}>
                                            {stats.goals > 0 ? `⚽${stats.goals} ` : ''}
                                            {stats.yellows > 0 ? `TA${stats.yellows} ` : ''}
                                            {stats.reds > 0 ? `TR${stats.reds}` : ''}
                                          </Text>
                                        )}
                                      </View>
                                    )
                                  })}
                                </View>
                              )
                            })}
                          </View>
                        )}

                        {pitchLines.home.length > 0 && (
                          <View style={styles.pitchHalfBottom}>
                            {pitchLines.home.map((line, lineIndex) => {
                              return (
                                <View key={`home-line-${lineIndex}`} style={styles.pitchLine}>
                                  {line.map((player) => {
                                    const stats = playedEventStats.get(normalizePlayerKey(player.name))
                                    return (
                                      <View key={player.id} style={styles.pitchPlayerWrap}>
                                        <View style={[styles.pitchPlayerHome, { backgroundColor: teamColors.home }]}>
                                          <Text style={styles.pitchPlayerNumber}>{player.number}</Text>
                                          {stats?.yellows ? <View style={styles.pitchCardYellow} /> : null}
                                          {stats?.reds ? <View style={styles.pitchCardRed} /> : null}
                                        </View>
                                        <Text numberOfLines={1} style={styles.pitchPlayerName}>{player.name}</Text>
                                        {stats && (stats.goals > 0 || stats.yellows > 0 || stats.reds > 0) && (
                                          <Text style={styles.pitchPlayerBadges}>
                                            {stats.goals > 0 ? `⚽${stats.goals} ` : ''}
                                            {stats.yellows > 0 ? `TA${stats.yellows} ` : ''}
                                            {stats.reds > 0 ? `TR${stats.reds}` : ''}
                                          </Text>
                                        )}
                                      </View>
                                    )
                                  })}
                                </View>
                              )
                            })}
                          </View>
                        )}
                      </>
                    )
                  })()}
                </View>
              </View>
            )}

            {activeMatchTab === 'events' && (
              <>
                <Text style={styles.sectionTitle}>Tabla de goles</Text>
                {goalsTable.length === 0 ? (
                  <Text style={styles.empty}>Aún no hay goles.</Text>
                ) : (
                  <ScrollView style={styles.tableScroll} nestedScrollEnabled>
                    <View style={styles.tableWrapper}>
                      {goalsTable.map((row) => (
                        <View key={row.id} style={styles.tableRow}>
                          <Text style={styles.tableMinute}>{row.minute}</Text>
                          <Text numberOfLines={1} style={styles.tableTeam}>{row.teamName}</Text>
                          <Text numberOfLines={1} style={styles.tablePlayer}>{row.playerName}</Text>
                          <Text style={styles.tableType}>{row.type}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}

                <Text style={styles.sectionTitle}>Eventos del partido</Text>
                <View style={styles.eventsBox}>
                  {timelineEvents.length === 0 ? (
                    <Text style={styles.empty}>Sin eventos todavía.</Text>
                  ) : (
                    <ScrollView style={styles.eventsScroll} nestedScrollEnabled>
                      {timelineEvents.map((event) => (
                        <Text key={event.id} style={styles.eventItem}>{event.text}</Text>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </>
            )}

            {activeMatchTab === 'highlights' && selectedMatchIsPlayed && (
              <>
                <Text style={styles.sectionTitle}>Highlights</Text>
                {highlightVideos.length === 0 ? (
                  <Text style={styles.empty}>Aún no hay videos publicados para este partido.</Text>
                ) : (
                  <ScrollView
                    horizontal
                    style={styles.highlightVideosCarousel}
                    contentContainerStyle={styles.highlightVideosScrollContent}
                    showsHorizontalScrollIndicator
                    decelerationRate="fast"
                    snapToAlignment="start"
                    snapToInterval={highlightCardWidth + 12}
                  >
                    {highlightVideos.map((video) => (
                      <HighlightVideoCard key={video.id} name={video.name} url={video.url} width={highlightCardWidth} />
                    ))}
                  </ScrollView>
                )}
              </>
            )}
          </View>
        )}

        <View style={styles.footerBox}>
          <Image source={{ uri: webLogoUri }} defaultSource={defaultFLLogo} style={styles.footerLogo} />
          <View style={styles.footerBrandText}>
            <Text style={styles.footerBrandTitle}>Fernando Lara Soft</Text>
            <Text style={styles.footerCopy}>© {year} · +593 993385551 · fernando.lara.moran@gmail.com</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MobileLiveApp />
    </QueryClientProvider>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
    position: 'relative',
  },
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 74,
    gap: 10,
  },
  topRow: {
    minHeight: 24,
  },
  followedMatchBar: {
    borderWidth: 1,
    borderColor: '#16a34a',
    backgroundColor: 'rgba(22,163,74,0.12)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 2,
  },
  followedMatchBarText: {
    color: '#14532d',
    fontSize: 12,
    fontWeight: '700',
  },
  followedMatchBarHint: {
    color: '#166534',
    fontSize: 10,
    marginTop: 2,
  },
  backButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  backButtonText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  hero: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    position: 'relative',
    overflow: 'hidden',
  },
  heroBackgroundImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.15,
    borderRadius: 16,
  },
  heroTextBox: {
    flex: 1,
    gap: 3,
    zIndex: 1,
  },
  heroOverline: {
    color: '#bae6fd',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  heroLogo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    borderColor: '#334155',
    borderWidth: 1,
    zIndex: 1,
  },
  title: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 12,
  },
  chipsRow: {
    maxHeight: 40,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    marginRight: 8,
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: '#0ea5e9',
    borderColor: '#0284c7',
  },
  chipText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  matchList: {
    flex: 1,
    minHeight: 0,
  },
  matchCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  matchText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  matchTeamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  matchTeam: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  matchTeamLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  matchTeamName: {
    fontWeight: '600',
    fontSize: 13,
    flex: 1,
  },
  matchVs: {
    fontSize: 12,
    fontWeight: '500',
  },
  matchCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'wrap',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  statusBadgeLive: {
    borderColor: '#fca5a5',
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  statusBadgeBreak: {
    borderColor: '#fcd34d',
    backgroundColor: 'rgba(245,158,11,0.12)',
  },
  statusBadgeFinished: {
    borderColor: '#6ee7b7',
    backgroundColor: 'rgba(16,185,129,0.12)',
  },
  statusBadgePending: {
    borderColor: '#93c5fd',
    backgroundColor: 'rgba(59,130,246,0.08)',
  },
  statusBadgePostponed: {
    borderColor: '#fdba74',
    backgroundColor: 'rgba(249,115,22,0.12)',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadgeTextLive: {
    color: '#ef4444',
  },
  statusBadgeTextBreak: {
    color: '#f59e0b',
  },
  statusBadgeTextFinished: {
    color: '#047857',
  },
  statusBadgeTextPending: {
    color: '#3b82f6',
  },
  statusBadgeTextPostponed: {
    color: '#ea580c',
  },
  livePulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  matchScoreBox: {
    marginTop: 6,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  matchScoreBoxLive: {
    borderColor: 'rgba(239,68,68,0.4)',
    backgroundColor: 'rgba(239,68,68,0.07)',
  },
  matchScoreBoxBreak: {
    borderColor: 'rgba(245,158,11,0.4)',
    backgroundColor: 'rgba(245,158,11,0.07)',
  },
  matchScoreBoxFinished: {
    borderColor: 'rgba(4,120,87,0.35)',
    backgroundColor: 'rgba(4,120,87,0.07)',
  },
  matchScoreLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  matchScoreLabelLive: {
    color: '#ef4444',
  },
  matchScoreLabelBreak: {
    color: '#f59e0b',
  },
  matchScoreLabelFinished: {
    color: '#047857',
  },
  matchMeta: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
  matchVenue: {
    color: '#475569',
    fontSize: 11,
    marginTop: 2,
  },
  matchActionsRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  followMatchButton: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#f8fafc',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  followMatchButtonActive: {
    borderColor: '#16a34a',
    backgroundColor: 'rgba(22,163,74,0.12)',
  },
  followMatchButtonText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
  },
  followMatchButtonTextActive: {
    color: '#166534',
  },
  detailCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  detailTitle: {
    color: '#64748b',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  score: {
    color: '#0f172a',
    fontSize: 32,
    fontWeight: '700',
    marginTop: 4,
  },
  scoreLabel: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 6,
  },
  detailMeta: {
    color: '#64748b',
    marginTop: 2,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  tabActive: {
    backgroundColor: '#0ea5e9',
    borderColor: '#0284c7',
  },
  tabText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 12,
  },
  tabTextActive: {
    color: '#ffffff',
  },
  sectionTitle: {
    color: '#1e293b',
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 6,
  },
  inlineSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
    gap: 8,
  },
  inlineSelectorLabel: {
    fontSize: 12,
    fontWeight: '700',
    minWidth: 42,
    flexShrink: 0,
    marginBottom: 0,
    marginTop: 0,
  },
  tableWrapper: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  tableScroll: {
    maxHeight: 200,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 6,
  },
  tableMinute: {
    width: 42,
    color: '#0ea5e9',
    fontWeight: '700',
  },
  tableTeam: {
    flex: 1,
    color: '#64748b',
  },
  tablePlayer: {
    flex: 1.2,
    color: '#0f172a',
    fontWeight: '600',
  },
  tableType: {
    width: 54,
    color: '#64748b',
    textAlign: 'right',
  },
  eventsBox: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 8,
    gap: 6,
    backgroundColor: '#ffffff',
  },
  eventsScroll: {
    maxHeight: 220,
  },
  eventItem: {
    color: '#1e293b',
    fontSize: 12,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  videoRow: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#0f172a',
  },
  highlightVideosCarousel: {
    marginTop: 2,
  },
  highlightVideosScrollContent: {
    gap: 12,
    paddingRight: 6,
  },
  videoName: {
    color: '#f8fafc',
    fontWeight: '700',
    marginBottom: 10,
  },
  videoPlayer: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
    backgroundColor: '#020617',
    overflow: 'hidden',
  },
  videoUrl: {
    color: '#7dd3fc',
    fontSize: 12,
  },
  pitchCard: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#ffffff',
    gap: 8,
  },
  pitchField: {
    height: 360,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#84cc16',
    backgroundColor: '#14532d',
    overflow: 'hidden',
    position: 'relative',
  },
  pitchHalfLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 2,
    backgroundColor: '#bbf7d0',
    marginTop: -1,
  },
  pitchCenterCircle: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#bbf7d0',
    marginLeft: -25,
    marginTop: -25,
  },
  pitchBoxTop: {
    position: 'absolute',
    left: '50%',
    top: 0,
    width: 90,
    height: 34,
    marginLeft: -45,
    borderWidth: 2,
    borderColor: '#bbf7d0',
    borderTopWidth: 0,
  },
  pitchBoxBottom: {
    position: 'absolute',
    left: '50%',
    bottom: 0,
    width: 90,
    height: 34,
    marginLeft: -45,
    borderWidth: 2,
    borderColor: '#bbf7d0',
    borderBottomWidth: 0,
  },
  pitchHalfTop: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: 10,
    bottom: '51%',
    justifyContent: 'space-around',
  },
  pitchHalfBottom: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: '51%',
    bottom: 10,
    justifyContent: 'space-around',
  },
  pitchLine: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
    gap: 4,
  },
  pitchPlayerWrap: {
    alignItems: 'center',
    maxWidth: 64,
    flex: 1,
  },
  pitchPlayerHome: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pitchPlayerAway: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pitchCardYellow: {
    position: 'absolute',
    top: -4,
    right: -3,
    width: 7,
    height: 10,
    borderRadius: 1,
    backgroundColor: '#facc15',
    borderWidth: 0.5,
    borderColor: '#fef08a',
  },
  pitchCardRed: {
    position: 'absolute',
    top: -4,
    right: 5,
    width: 7,
    height: 10,
    borderRadius: 1,
    backgroundColor: '#ef4444',
    borderWidth: 0.5,
    borderColor: '#fecaca',
  },
  pitchPlayerNumber: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  pitchPlayerName: {
    color: '#ffffff',
    fontSize: 9,
    marginTop: 2,
    fontWeight: '600',
    textAlign: 'center',
  },
  pitchPlayerBadges: {
    color: '#e2e8f0',
    fontSize: 8,
    marginTop: 1,
    textAlign: 'center',
  },
  pitchInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pitchTeam: {
    flex: 1,
    color: '#e2e8f0',
    fontWeight: '600',
    fontSize: 12,
  },
  pitchScore: {
    color: '#f8fafc',
    fontSize: 26,
    fontWeight: '800',
  },
  pitchStatus: {
    color: '#67e8f9',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  empty: {
    color: '#64748b',
    fontSize: 12,
  },
  error: {
    color: '#fda4af',
    fontSize: 12,
  },
  roundAwardCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  roundAwardTitle: {
    color: '#fde68a',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  roundAwardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roundAwardPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#0f172a',
  },
  roundAwardPhotoFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundAwardPhotoFallbackText: {
    color: '#fde68a',
    fontWeight: '700',
    fontSize: 11,
  },
  roundAwardMeta: {
    flex: 1,
  },
  roundAwardName: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  roundAwardTeam: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
  },
  footerBox: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 8,
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 14,
    backgroundColor: '#0b1120EE',
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  footerLogo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    borderColor: '#334155',
    borderWidth: 1,
  },
  footerBrandText: {
    flex: 1,
    gap: 2,
  },
  footerBrandTitle: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  footerCopy: {
    color: '#94a3b8',
    fontSize: 10,
  },
  statsScroll: {
    maxHeight: 320,
  },
  standingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginBottom: 6,
    borderRadius: 8,
    gap: 8,
  },
  standingsPosition: {
    width: 24,
    color: '#67e8f9',
    fontWeight: '700',
    fontSize: 14,
  },
  teamLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  standingsTeam: {
    flex: 1,
  },
  standingsTeamName: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 13,
  },
  standingsStats: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  standingsPoints: {
    color: '#22d3ee',
    fontWeight: '800',
    fontSize: 18,
    width: 36,
    textAlign: 'right',
  },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginBottom: 6,
    borderRadius: 8,
    gap: 8,
  },
  rankingPosition: {
    width: 24,
    color: '#67e8f9',
    fontWeight: '700',
    fontSize: 14,
  },
  rankingInfo: {
    flex: 1,
  },
  rankingName: {
    color: '#f8fafc',
    fontWeight: '600',
    fontSize: 13,
  },
  rankingTeam: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  rankingValue: {
    color: '#22d3ee',
    fontWeight: '700',
    fontSize: 16,
    minWidth: 50,
    textAlign: 'right',
  },
  mvpCard: {
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 10,
    alignItems: 'center',
  },
  mvpTitle: {
    color: '#fcd34d',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  mvpName: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  mvpTeam: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 3,
  },
  topLeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#0f172a',
  },
  topLeaderPosition: {
    color: '#fcd34d',
    width: 18,
    fontWeight: '700',
    fontSize: 13,
  },
  topLeaderPhoto: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  topLeaderPhotoFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#fde68a',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
  },
  topLeaderPhotoFallbackText: {
    color: '#fde68a',
    fontSize: 9,
    fontWeight: '700',
  },
  topLeaderMeta: {
    flex: 1,
  },
  topLeaderName: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 12,
  },
  topLeaderTeam: {
    color: '#94a3b8',
    fontSize: 10,
  },
  topLeaderVotes: {
    color: '#67e8f9',
    fontWeight: '700',
    fontSize: 11,
  },
})
