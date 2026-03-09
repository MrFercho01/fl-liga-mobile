import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
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

type AppStep = 'company' | 'league' | 'matches' | 'match'
type LeagueTab = 'matches' | 'overview'
type MatchTab = 'pitch' | 'events' | 'highlights'

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
  if (!hex) return '#020617'
  const value = hex.trim()
  if (!/^#([0-9a-fA-F]{6})$/.test(value)) return '#020617'
  return `${value}${alphaHex}`
}

const MobileLiveApp = () => {
  const [step, setStep] = useState<AppStep>('company')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedLeagueId, setSelectedLeagueId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedRound, setSelectedRound] = useState(1)
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [activeLeagueTab, setActiveLeagueTab] = useState<LeagueTab>('matches')
  const [activeMatchTab, setActiveMatchTab] = useState<MatchTab>('pitch')
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

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? null,
    [matches, selectedMatchId],
  )

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
    return fixtureQuery.data.playedMatches.find((record) => record.matchId === selectedMatch.id) ?? null
  }, [fixtureQuery.data, selectedMatch])

  const scoreLine = useMemo(() => {
    if (!selectedMatch) return '0 - 0'
    if (liveForSelected) return `${liveForSelected.homeTeam.stats.goals} - ${liveForSelected.awayTeam.stats.goals}`
    if (playedRecord) return `${playedRecord.homeGoals} - ${playedRecord.awayGoals}`
    return '0 - 0'
  }, [selectedMatch, liveForSelected, playedRecord])

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

  const leagueThemeColor = fixtureQuery.data?.league.themeColor ?? selectedLeague?.themeColor ?? '#0ea5e9'
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
      setStep('league')
      return
    }

    if (step === 'league') {
      setStep('company')
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: withAlpha(leagueThemeColor, '22') }]}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <View style={styles.topRow}>{step !== 'company' && <Pressable style={styles.backButton} onPress={handleBack}><Text style={styles.backButtonText}>← Volver</Text></Pressable>}</View>

        <View
          style={[
            styles.hero,
            {
              backgroundColor: withAlpha(leagueThemeColor, '1A'),
              borderColor: withAlpha(leagueThemeColor, '88'),
            },
          ]}
        >
          <View style={styles.heroTextBox}>
            <Text style={styles.heroOverline}>FL Liga · Mobile Live</Text>
            <Text style={styles.title}>{leagueName}</Text>
            <Text style={styles.subtitle}>{leagueSubtitle}</Text>
          </View>
          <Image source={heroLogoSource} defaultSource={defaultFLLogo} style={styles.heroLogo} />
        </View>

        {clientsQuery.isLoading && <ActivityIndicator color="#38bdf8" />}
        {clientsQuery.isError && <Text style={styles.error}>No se pudieron cargar clientes desde Render/Mongo.</Text>}

        {step === 'company' && (
          <>
            <Text style={styles.sectionTitle}>1) Elige la empresa</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
              {(clientsQuery.data ?? []).map((client) => (
                <Pressable
                  key={client.id}
                  style={[styles.chip, selectedClientId === client.id && styles.chipActive]}
                  onPress={() => {
                    setSelectedClientId(client.id)
                    setSelectedLeagueId('')
                    setSelectedCategoryId('')
                    setSelectedRound(1)
                    setSelectedMatchId('')
                    setStep('league')
                  }}
                >
                  <Text style={[styles.chipText, selectedClientId === client.id && styles.chipTextActive]}>
                    {client.organizationName ?? client.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {step === 'league' && selectedClient && (
          <>
            <Text style={styles.sectionTitle}>2) Elige la liga del cliente</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
              {leagues.map((league) => (
                <Pressable
                  key={league.id}
                  style={[styles.chip, selectedLeagueId === league.id && styles.chipActive]}
                  onPress={() => {
                    setSelectedLeagueId(league.id)
                    setSelectedCategoryId(league.categories[0]?.id ?? '')
                    setSelectedRound(1)
                    setSelectedMatchId('')
                    setStep('matches')
                  }}
                >
                  <Text style={[styles.chipText, selectedLeagueId === league.id && styles.chipTextActive]}>{league.name}</Text>
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
                style={[styles.tab, activeLeagueTab === 'matches' && styles.tabActive]}
                onPress={() => setActiveLeagueTab('matches')}
              >
                <Text style={[styles.tabText, activeLeagueTab === 'matches' && styles.tabTextActive]}>Partidos</Text>
              </Pressable>
              <Pressable
                style={[styles.tab, activeLeagueTab === 'overview' && styles.tabActive]}
                onPress={() => setActiveLeagueTab('overview')}
              >
                <Text style={[styles.tabText, activeLeagueTab === 'overview' && styles.tabTextActive]}>Resumen</Text>
              </Pressable>
            </View>

            {activeLeagueTab === 'matches' ? (
              <>
                <Text style={styles.sectionTitle}>Categorías</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                  {categories.map((category) => (
                    <Pressable
                      key={category.id}
                      style={[styles.chip, activeCategory?.id === category.id && styles.chipActive]}
                      onPress={() => {
                        setSelectedCategoryId(category.id)
                        setSelectedRound(1)
                        setSelectedMatchId('')
                      }}
                    >
                      <Text style={[styles.chipText, activeCategory?.id === category.id && styles.chipTextActive]}>
                        {category.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

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
                      <Text style={[styles.chipText, selectedRound === round.round && styles.chipTextActive]}>
                        Fecha {round.round}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <Text style={styles.sectionTitle}>Partidos (jugados y por jugar)</Text>
                <FlatList
                  data={matchesByRound}
                  keyExtractor={(item) => item.id}
                  style={styles.matchList}
                  renderItem={({ item }) => {
                    const homeName = teamsMap.get(item.homeTeamId) ?? 'Local'
                    const awayName = teamsMap.get(item.awayTeamId) ?? 'Visita'
                    return (
                      <Pressable
                        style={styles.matchCard}
                        onPress={() => {
                          setSelectedMatchId(item.id)
                          setActiveMatchTab('pitch')
                          setStep('match')
                        }}
                      >
                        <Text style={styles.matchText}>{homeName} vs {awayName}</Text>
                        <Text style={styles.matchMeta}>
                          {item.played ? 'Finalizado' : item.scheduledAt ? 'Programado' : 'Pendiente'}
                        </Text>
                      </Pressable>
                    )
                  }}
                  ListEmptyComponent={<Text style={styles.empty}>Sin partidos para esta fecha.</Text>}
                />
              </>
            ) : (
              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>Liga seleccionada</Text>
                <Text style={styles.scoreLabel}>{leagueName}</Text>
                <Text style={styles.detailMeta}>{activeCategory?.name ?? 'Sin categoría activa'}</Text>
              </View>
            )}
          </>
        )}

        {step === 'match' && selectedMatch && (
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>
              {selectedMatchIsLive ? 'Partido en vivo' : selectedMatchIsPlayed ? 'Partido finalizado' : 'Partido programado'}
            </Text>
            <Text style={styles.score}>{scoreLine}</Text>
            <Text style={styles.detailMeta}>
              {teamsMap.get(selectedMatch.homeTeamId)} vs {teamsMap.get(selectedMatch.awayTeamId)}
            </Text>

            <View style={styles.tabsRow}>
              <Pressable
                style={[styles.tab, activeMatchTab === 'pitch' && styles.tabActive]}
                onPress={() => setActiveMatchTab('pitch')}
              >
                <Text style={[styles.tabText, activeMatchTab === 'pitch' && styles.tabTextActive]}>Cancha</Text>
              </Pressable>
              <Pressable
                style={[styles.tab, activeMatchTab === 'events' && styles.tabActive]}
                onPress={() => setActiveMatchTab('events')}
              >
                <Text style={[styles.tabText, activeMatchTab === 'events' && styles.tabTextActive]}>Eventos</Text>
              </Pressable>
              {selectedMatchIsPlayed && (
                <Pressable
                  style={[styles.tab, activeMatchTab === 'highlights' && styles.tabActive]}
                  onPress={() => setActiveMatchTab('highlights')}
                >
                  <Text style={[styles.tabText, activeMatchTab === 'highlights' && styles.tabTextActive]}>Highlights</Text>
                </Pressable>
              )}
            </View>

            {activeMatchTab === 'pitch' && (
              <View style={styles.pitchCard}>
                <View style={styles.pitchField}>
                  <View style={styles.pitchHalfLine} />
                  <View style={styles.pitchCenterCircle} />
                  <View style={styles.pitchBoxLeft} />
                  <View style={styles.pitchBoxRight} />
                </View>
                <View style={styles.pitchInfoRow}>
                  <Text style={styles.pitchTeam}>{teamsMap.get(selectedMatch.homeTeamId) ?? 'Local'}</Text>
                  <Text style={styles.pitchScore}>{scoreLine}</Text>
                  <Text style={styles.pitchTeam}>{teamsMap.get(selectedMatch.awayTeamId) ?? 'Visita'}</Text>
                </View>
                {selectedMatchIsLive && <Text style={styles.pitchStatus}>En vivo · {liveForSelected?.currentMinute ?? 0}'</Text>}
                {!selectedMatchIsLive && selectedMatchIsPlayed && (
                  <Text style={styles.pitchStatus}>Finalizado · {playedRecord?.finalMinute ?? 0}'</Text>
                )}
                {!selectedMatchIsLive && !selectedMatchIsPlayed && <Text style={styles.pitchStatus}>Programado</Text>}
              </View>
            )}

            {activeMatchTab === 'events' && (
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
                    timelineEvents.slice(0, 20).map((event) => (
                      <Text key={event.id} style={styles.eventItem}>{event.text}</Text>
                    ))
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
                  highlightVideos.map((video) => (
                    <Pressable key={video.id} style={styles.videoRow} onPress={() => void Linking.openURL(video.url)}>
                      <Text style={styles.videoName}>{video.name}</Text>
                      <Text numberOfLines={1} style={styles.videoUrl}>{video.url}</Text>
                    </Pressable>
                  ))
                )}
              </>
            )}
          </View>
        )}

        <View style={styles.footerBox}>
          <View style={styles.footerBrandRow}>
            <Image source={{ uri: webLogoUri }} defaultSource={defaultFLLogo} style={styles.footerLogo} />
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
  topRow: {
    minHeight: 24,
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
    color: '#cbd5e1',
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
    maxHeight: 230,
  },
  matchCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
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
  scoreLabel: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 6,
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
    fontSize: 12,
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
    marginBottom: 8,
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
  pitchCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#0b1220',
    gap: 8,
  },
  pitchField: {
    height: 160,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#84cc16',
    backgroundColor: '#14532d',
    overflow: 'hidden',
    position: 'relative',
  },
  pitchHalfLine: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#bbf7d0',
    marginLeft: -1,
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
  pitchBoxLeft: {
    position: 'absolute',
    left: 0,
    top: 45,
    width: 28,
    height: 70,
    borderWidth: 2,
    borderColor: '#bbf7d0',
    borderLeftWidth: 0,
  },
  pitchBoxRight: {
    position: 'absolute',
    right: 0,
    top: 45,
    width: 28,
    height: 70,
    borderWidth: 2,
    borderColor: '#bbf7d0',
    borderRightWidth: 0,
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
