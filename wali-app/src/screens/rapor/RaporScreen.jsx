import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { raporApi } from '../../api/rapor.api';
import { ChildSwitcherBar } from '../../components/dashboard/ChildSwitcherBar';
import { ScreenContainer, AppCard, AppText, Button, EmptyState, StatusBadge } from '../../components/ui';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { ErrorView } from '../../components/common/ErrorView';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/theme';

export function RaporScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(null);
  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try { const response = await raporApi.list(); setItems(response.data || []); setError(''); }
    catch (err) { setError(err.response?.data?.error || 'Rapor gagal dimuat'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const download = async (item) => {
    setSharing(item.id);
    try {
      const bytes = await raporApi.pdf(item.id);
      const file = new File(Paths.cache, `rapor-${item.id}.pdf`);
      if (file.exists) file.delete();
      file.create();
      file.write(new Uint8Array(bytes));
      if (!(await Sharing.isAvailableAsync())) throw new Error('Fitur berbagi file tidak tersedia pada perangkat ini');
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Unduh atau bagikan rapor' });
    } catch (err) { setError(err.response?.data?.error || err.message || 'PDF gagal dibuka'); }
    finally { setSharing(null); }
  };
  if (loading && !items.length) return <ScreenContainer><ChildSwitcherBar /><LoadingSpinner message="Memuat rapor resmi..." /></ScreenContainer>;
  if (error && !items.length) return <ScreenContainer><ChildSwitcherBar /><ErrorView message={error} onRetry={() => load()} /></ScreenContainer>;
  return <ScreenContainer><FlatList
    data={items}
    keyExtractor={(item) => String(item.id)}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.primary]} />}
    contentContainerStyle={styles.list}
    ListHeaderComponent={<><ChildSwitcherBar /><View style={styles.header}><AppText variant="h2">Rapor Semester</AppText><AppText variant="caption" color="muted">Hanya rapor resmi yang sudah diterbitkan sekolah.</AppText></View>{error ? <AppText color="danger">{error}</AppText> : null}</>}
    ListEmptyComponent={<EmptyState title="Belum Ada Rapor Terbit" description="Rapor akan muncul setelah disetujui dan diterbitkan sekolah." icon="document-text-outline" />}
    renderItem={({ item }) => <AppCard padding="md" style={styles.card}>
      <View style={styles.row}><View style={styles.copy}><AppText variant="h3">{item.period?.academic_year || '-'} · {item.period?.semester || '-'}</AppText><AppText variant="caption" color="muted">{item.class_name || '-'}</AppText><AppText variant="bodyMedium">Rata-rata {item.summary?.average ?? '-'}</AppText><AppText variant="caption">Peringkat {item.ranking?.rank ?? '-'} dari {item.ranking?.participant_count ?? '-'} santri</AppText></View><StatusBadge variant="success">TERBIT</StatusBadge></View>
      <Button onPress={() => download(item)} disabled={sharing === item.id}>{sharing === item.id ? 'Menyiapkan PDF...' : 'Buka / Unduh PDF'}</Button>
    </AppCard>}
  /></ScreenContainer>;
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing['3xl'] },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  copy: { flex: 1, gap: spacing.xs },
});
