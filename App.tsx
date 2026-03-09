import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useLiveSocket } from './src/hooks/useLiveSocket'
import { mobileApi } from './src/services/api'
import type { LiveEvent, LiveMatch, PublicClientSummary, ScheduledMatch } from './src/types'

const queryClient = new QueryClient()
const defaultFLLogo = require('./assets/icon.png')

const formatMatchId = (round: number, index: number, homeTeamId: string, awayTeamId: string) =>
  `${round}-${index}-${homeTeamId}-${awayTeamId}`

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

const withAlpha = (hex: string | undefined, alphaHex: string) => {
  if (!hex) return '#0f172a'
  const value = hex.trim()
  if (!/^#([0-9a-fA-F]{6})$/.test(value)) return '#0f172a'
  return `${value}${alphaHex}`
}

const MobileLiveApp = () => {
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedLeagueId, setSelectedLeagueId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedRound, setSelectedRound] = useState(1)
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [activeTab, setActiveTab] = useState<'live' | 'highlights'>('live')
  const [liveMatch, setLiveMatch] = useState<LiveMatch | null>(null)

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
      mobileApi.getPublicClientLeagueFixture(selectedClient?.publicRouteAlias ?? selectedClient?.id ?? '', selectedLeagueId, activeCategory?.id ?? ''),
    enabled: Boolean(selectedClient && selectedLeagueId && activeCategory?.id),
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

    setSelectedLeagueId((current) => (current && leagues.some((league) => league.id === current) ? current : firstLeague.id))
    setSelectedCategoryId((current) => {
      const hasCurrent = selectedLeague?.categories.some((category) => category.id === current)
      if (hasCurrent) return current
      return firstLeague.categories[0]?.id ?? ''
    })
  }, [leagues, selectedLeague?.categories])

  useEffect(() => {
    if (!fixtureQuery.data) return
    const firstRound = fixtureQuery.data.fixture.rounds[0]?.round ?? 1
    setSelectedRound(firstRound)
    setSelectedMatchId('')
  }, [fixtureQuery.data?.category.id, fixtureQuery.data?.league.id])

  const teamsMap = useMemo(() => {
    const map = new Map<string, string>()
    fixtureQuery.data?.teams.forEach((team) => {
      map.set(team.id, team.name)
    })
    return map
  }, [fixtureQuery.data?.teams])

  const matches = useMemo(() => {
    const fixture = fixtureQuery.data
    if (!fixture) return [] as ScheduledMatch[]

    const scheduleByMatchId = new Map(fixture.schedule.map((item) => [item.matchId, item]))
    const result: ScheduledMatch[] = []

    fixture.fixture.rounds.forEach((round) => {
      round.matches.forEach((match, index) => {
        if (match.hasBye || !match.awayTeamId) return

        const generatedId = formatMatchId(round.round, index, match.homeTeamId, match.awayTeamId)
        const schedule = scheduleByMatchId.get(generatedId)

        result.push({
          id: generatedId,
          round: round.round,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          played: fixture.playedMatchIds.includes(generatedId),
          scheduledAt: schedule?.scheduledAt,
          venue: schedule?.venue,
        })
      })
    })

    return result
  }, [fixtureQuery.data])

  const matchesByRound = useMemo(() => matches.filter((match) => match.round === selectedRound), [matches, selectedRound])

  useEffect(() => {
    if (matchesByRound.length === 0) return
    setSelectedMatchId((current) => current || matchesByRound[0]?.id || '')
  }, [matchesByRound])

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? null

  const liveForSelected = useMemo(() => {
    if (!liveMatch || !selectedMatch) return null

    const sameOrder = liveMatch.homeTeam.id === selectedMatch.homeTeamId && liveMatch.awayTeam.id === selectedMatch.awayTeamId
    const swappedOrder = liveMatch.homeTeam.id === selectedMatch.awayTeamId && liveMatch.awayTeam.id === selectedMatch.homeTeamId
    return sameOrder || swappedOrder ? liveMatch : null
  }, [liveMatch, selectedMatch])

  const playedRecord = useMemo(() => {
    if (!fixtureQuery.data || !selectedMatch) return null
    return fixtureQuery.data.playedMatches.find((record) => record.matchId === selectedMatch.id) ?? null
  }, [fixtureQuery.data, selectedMatch])

  const scoreLine = useMemo(() => {
    if (!selectedMatch) return 'Selecciona un partido'

    if (liveForSelected) {
      return `${liveForSelected.homeTeam.stats.goals} - ${liveForSelected.awayTeam.stats.goals}`
    }

    if (playedRecord) {
      return `${playedRecord.homeGoals} - ${playedRecord.awayGoals}`
    }

    return '0 - 0'
  }, [liveForSelected, playedRecord, selectedMatch])

  const timelineEvents = useMemo(() => {
    if (liveForSelected) {
      return liveForSelected.events.slice().reverse().map((event) => {
        const team = event.teamId === liveForSelected.homeTeam.id ? liveForSelected.homeTeam : liveForSelected.awayTeam
        const outName = event.playerId ? (team.players.find((player) => player.id === event.playerId)?.name ?? 'Sin jugadora') : 'Sin jugadora'
        const inName = event.substitutionInPlayerId
          ? (team.players.find((player) => player.id === event.substitutionInPlayerId)?.name ?? '')
          : ''

        const actor = event.type === 'substitution' && inName
          ? `${outName} ↘ · ${inName} ↗`
          : outName

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
          const team = event.teamId === liveForSelected.homeTeam.id ? liveForSelected.homeTeam : liveForSelected.awayTeam
          const playerName = event.playerId
            ? (team.players.find((player) => player.id === event.playerId)?.name ?? 'Sin jugadora')
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

  const leagueThemeColor = fixtureQuery.data?.league.themeColor ?? selectedLeague?.themeColor ?? '#0ea5e9'
  const leagueLogoUrl = fixtureQuery.data?.league.logoUrl ?? selectedLeague?.logoUrl
  const heroLogoSource = leagueLogoUrl ? { uri: leagueLogoUrl } : defaultFLLogo
  const year = new Date().getFullYear()
  const leagueName = fixtureQuery.data?.league.name ?? selectedLeague?.name ?? 'FL Liga Mobile'
  const leagueSubtitle = selectedClient?.organizationName
    ? `${selectedClient.organizationName} · ${activeCategory?.name ?? 'Categorías'}`
    : `${selectedClient?.name ?? 'Multicliente'} · ${activeCategory?.name ?? 'Categorías'}`

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <View style={[styles.hero, { backgroundColor: withAlpha(leagueThemeColor, '1A'), borderColor: withAlpha(leagueThemeColor, '80') }]}>
          <View style={styles.heroTextBox}>
            <Text style={styles.heroOverline}>FL Liga · Mobile Live</Text>
            <Text style={styles.title}>{leagueName}</Text>
            <Text style={styles.subtitle}>{leagueSubtitle}</Text>
          </View>
          <Image source={heroLogoSource} style={styles.heroLogo} />
        </View>

        {clientsQuery.isLoading && <ActivityIndicator color="#38bdf8" />}
        {clientsQuery.isError && (
          <Text style={styles.error}>
            No se pudieron cargar clientes desde backend público. Verifica Render y Mongo.
          </Text>
        )}

        <Text style={styles.sectionTitle}>Clientes / Usuarios</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
          {(clientsQuery.data ?? []).map((client) => (
            <Pressable
              key={client.id}
              style={[styles.chip, selectedClientId === client.id && styles.chipActive, selectedClientId === client.id && { borderColor: leagueThemeColor }]}
              onPress={() => {
                setSelectedClientId(client.id)
                setSelectedLeagueId('')
                setSelectedCategoryId('')
                setSelectedRound(1)
                setSelectedMatchId('')
              }}
            >
              <Text style={[styles.chipText, selectedClientId === client.id && styles.chipTextActive]}>
                {client.organizationName ?? client.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {selectedClient && leagues.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Ligas del cliente</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
              {leagues.map((league) => (
                <Pressable
                  key={league.id}
                  style={[styles.chip, selectedLeagueId === league.id && styles.chipActive]}
                  onPress={() => {
                    setSelectedLeagueId(league.id)
                    setSelectedCategoryId(league.categories[0]?.id ?? '')
                  }}
                >
                  <Text style={[styles.chipText, selectedLeagueId === league.id && styles.chipTextActive]}>{league.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {categories.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Categorías</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                  {categories.map((category) => (
                  <Pressable
                    key={category.id}
                    style={[styles.chip, activeCategory?.id === category.id && styles.chipActive]}
                    onPress={() => setSelectedCategoryId(category.id)}
                  >
                    <Text style={[styles.chipText, activeCategory?.id === category.id && styles.chipTextActive]}>{category.name}</Text>
                  </Pressable>
                  ))}
                </ScrollView>
              </>
            )}
          </>
        )}

        {selectedClient && leagues.length === 0 && <Text style={styles.empty}>Este cliente no tiene ligas públicas activas.</Text>}

        {fixtureQuery.isLoading && <ActivityIndicator color="#22d3ee" />}
        {fixtureQuery.isError && <Text style={styles.error}>No se pudo cargar fixture desde backend de Render.</Text>}

        {fixtureQuery.data && (
          <>
            <Text style={styles.sectionTitle}>Fechas</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
              {fixtureQuery.data.fixture.rounds.map((round) => (
                <Pressable
                  key={round.round}
                  style={[styles.chip, selectedRound === round.round && styles.chipActive]}
                  onPress={() => {
                    setSelectedRound(round.round)
                    setSelectedMatchId('')
                  }}
                >
                  <Text style={[styles.chipText, selectedRound === round.round && styles.chipTextActive]}>Fecha {round.round}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.sectionTitle}>Partidos</Text>

            <FlatList
              data={matchesByRound}
              keyExtractor={(item) => item.id}
              style={styles.matchList}
              renderItem={({ item }) => {
                const homeName = teamsMap.get(item.homeTeamId) ?? 'Local'
                const awayName = teamsMap.get(item.awayTeamId) ?? 'Visita'
                return (
                  <Pressable
                    style={[styles.matchCard, selectedMatchId === item.id && styles.matchCardActive]}
                    onPress={() => setSelectedMatchId(item.id)}
                  >
                    <Text style={styles.matchText}>{homeName} vs {awayName}</Text>
                    <Text style={styles.matchMeta}>{item.played ? 'Finalizado' : item.scheduledAt ? 'Programado' : 'Pendiente'}</Text>
                  </Pressable>
                )
              }}
              ListEmptyComponent={<Text style={styles.empty}>Sin partidos para esta fecha.</Text>}
            />

            {selectedMatch && (
              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>Marcador del partido</Text>
                <Text style={styles.score}>{scoreLine}</Text>
                <Text style={styles.detailMeta}>
                  {teamsMap.get(selectedMatch.homeTeamId)} vs {teamsMap.get(selectedMatch.awayTeamId)}
                </Text>

                <View style={styles.tabsRow}>
                  <Pressable style={[styles.tab, activeTab === 'live' && styles.tabActive]} onPress={() => setActiveTab('live')}>
                    <Text style={[styles.tabText, activeTab === 'live' && styles.tabTextActive]}>Eventos</Text>
                  </Pressable>
                  <Pressable style={[styles.tab, activeTab === 'highlights' && styles.tabActive]} onPress={() => setActiveTab('highlights')}>
                    <Text style={[styles.tabText, activeTab === 'highlights' && styles.tabTextActive]}>Highlights</Text>
                  </Pressable>
                </View>

                {activeTab === 'live' ? (
                  <>
                    <Text style={styles.sectionTitle}>Tabla de goles</Text>
                    {goalsTable.length === 0 ? (
                      <Text style={styles.empty}>Aún no hay goles.</Text>
                    ) : (
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
                    )}

                    <Text style={styles.sectionTitle}>Eventos del partido</Text>
                    <View style={styles.eventsBox}>
                      {timelineEvents.length === 0 ? (
                        <Text style={styles.empty}>Sin eventos todavía.</Text>
                      ) : (
                        timelineEvents.slice(0, 18).map((event) => (
                          <Text key={event.id} style={styles.eventItem}>{event.text}</Text>
                        ))
                      )}
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.sectionTitle}>Videos de mejores jugadas / goles</Text>
                    {highlightVideos.length === 0 ? (
                      <Text style={styles.empty}>Aún no hay videos publicados para este partido.</Text>
                    ) : (
                      highlightVideos.map((video) => (
                        <View key={video.id} style={styles.videoRow}>
                          <Text style={styles.videoName}>{video.name}</Text>
                          <Text numberOfLines={1} style={styles.videoUrl}>{video.url}</Text>
                        </View>
                      ))
                    )}
                  </>
                )}
              </View>
            )}
          </>
        )}

        <View style={styles.footerBox}>
          <View style={styles.footerBrandRow}>
            <Image source={defaultFLLogo} style={styles.footerLogo} />
            <View style={styles.footerBrandText}>
              <Text style={styles.footerBrandTitle}>Fernando Lara Soft</Text>
              <Text style={styles.footerBrandSubtitle}>Soluciones digitales innovadoras para tu negocio</Text>
              <Text style={styles.footerBrandAuthor}>Desarrollado por Fernando Lara Morán</Text>
              <Text style={styles.footerCopy}>© {year} Todos los derechos reservados</Text>
            </View>
          </View>

          <View style={styles.footerContactCard}>
            <Text style={styles.footerContactTitle}>Contacto directo</Text>
            <Text style={styles.footerContactItem}>WhatsApp: +593 993385551</Text>
            <Text style={styles.footerContactItem}>Celular: +593 993385551</Text>
            <Text style={styles.footerContactItem}>fernando.lara.moran@gmail.com</Text>
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
    backgroundColor: '#020617',
  },
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 10,
  },
  hero: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroTextBox: {
    flex: 1,
    gap: 3,
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
    padding: 2,
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
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: '#155e75',
    borderColor: '#38bdf8',
  },
  chipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#cffafe',
  },
  matchList: {
    maxHeight: 190,
  },
  matchCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  matchCardActive: {
    borderColor: '#22d3ee',
    backgroundColor: '#0b2537',
  },
  matchText: {
    color: '#f8fafc',
    fontWeight: '600',
  },
  matchMeta: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
  },
  detailCard: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  detailTitle: {
    color: '#cbd5e1',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  score: {
    color: '#f8fafc',
    fontSize: 32,
    fontWeight: '700',
    marginTop: 4,
  },
  detailMeta: {
    color: '#94a3b8',
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
    borderColor: '#334155',
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#164e63',
    borderColor: '#22d3ee',
  },
  tabText: {
    color: '#cbd5e1',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#cffafe',
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 6,
  },
  tableWrapper: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 6,
  },
  tableMinute: {
    width: 42,
    color: '#67e8f9',
    fontWeight: '700',
  },
  tableTeam: {
    flex: 1,
    color: '#cbd5e1',
  },
  tablePlayer: {
    flex: 1.2,
    color: '#f8fafc',
    fontWeight: '600',
  },
  tableType: {
    width: 54,
    color: '#94a3b8',
    textAlign: 'right',
  },
  eventsBox: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 8,
    gap: 6,
  },
  eventItem: {
    color: '#cbd5e1',
    fontSize: 12,
    borderRadius: 8,
    backgroundColor: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  videoRow: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#111827',
  },
  videoName: {
    color: '#f8fafc',
    fontWeight: '700',
    marginBottom: 4,
  },
  videoUrl: {
    color: '#7dd3fc',
    fontSize: 12,
  },
  empty: {
    color: '#94a3b8',
    fontSize: 12,
  },
  error: {
    color: '#fda4af',
    fontSize: 12,
  },
  footerBox: {
    marginTop: 6,
    marginBottom: 12,
    gap: 10,
  },
  footerBrandRow: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 14,
    backgroundColor: '#0b1120',
    padding: 10,
  },
  footerLogo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    borderColor: '#334155',
    borderWidth: 1,
    padding: 2,
  },
  footerBrandText: {
    flex: 1,
    gap: 2,
  },
  footerBrandTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  footerBrandSubtitle: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  footerBrandAuthor: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '600',
  },
  footerCopy: {
    color: '#94a3b8',
    fontSize: 11,
  },
  footerContactCard: {
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 14,
    backgroundColor: '#0b1120',
    padding: 10,
    gap: 3,
  },
  footerContactTitle: {
    color: '#f8fafc',
    fontWeight: '700',
    marginBottom: 2,
  },
  footerContactItem: {
    color: '#cbd5e1',
    fontSize: 12,
  },
})
