import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { stackHeaderOptions } from '../constants/theme';
import { MonitoringScreen } from '../screens/monitoring/MonitoringScreen';
import { AbsensiScreen } from '../screens/absensi/AbsensiScreen';
import { NilaiScreen } from '../screens/nilai/NilaiScreen';
import { RaporScreen } from '../screens/rapor/RaporScreen';
import { HafalanScreen } from '../screens/hafalan/HafalanScreen';
import { PerizinanScreen } from '../screens/perizinan/PerizinanScreen';
import { PelanggaranScreen } from '../screens/pelanggaran/PelanggaranScreen';
import { KesehatanScreen } from '../screens/kesehatan/KesehatanScreen';
import { useActiveChild } from '../context/ActiveChildContext';
import { useWaliFeatures } from '../hooks/useWaliFeatures';

const Stack = createNativeStackNavigator();

export function MonitoringStack() {
  const { activeChild } = useActiveChild();
  const { features } = useWaliFeatures(activeChild);
  return (
    <Stack.Navigator screenOptions={stackHeaderOptions}>
      <Stack.Screen
        name="MonitoringHome"
        component={MonitoringScreen}
        options={{ headerShown: false }}
      />
      {features.absensi === true ? <Stack.Screen name="Absensi" component={AbsensiScreen} options={{ title: 'Absensi' }} /> : null}
      {features.nilai === true ? <Stack.Screen name="Nilai" component={NilaiScreen} options={{ title: 'Nilai Akademik' }} /> : null}
      {features.nilai === true ? <Stack.Screen name="Rapor" component={RaporScreen} options={{ title: 'Rapor Semester' }} /> : null}
      {features.hafalan === true ? <Stack.Screen name="Hafalan" component={HafalanScreen} options={{ title: 'Hafalan' }} /> : null}
      {features.perizinan === true ? <Stack.Screen name="Perizinan" component={PerizinanScreen} options={{ title: 'Riwayat Izin' }} /> : null}
      {features.pelanggaran === true ? <Stack.Screen name="Pelanggaran" component={PelanggaranScreen} options={{ title: 'Pelanggaran' }} /> : null}
      {features.kesehatan === true ? <Stack.Screen name="Kesehatan" component={KesehatanScreen} options={{ title: 'Kesehatan' }} /> : null}
    </Stack.Navigator>
  );
}
