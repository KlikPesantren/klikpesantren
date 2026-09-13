import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildTabBarScreenOptions, stackHeaderOptions } from '../constants/theme';

import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { PengumumanStack } from './PengumumanStack';
import { MonitoringStack } from './MonitoringStack';
import { KeuanganStack } from './KeuanganStack';
import { ProfilStack } from './ProfilStack';
import { AnakPilihScreen } from '../screens/anak/AnakPilihScreen';
import { NotificationsScreen } from '../screens/notifications/NotificationsScreen';
import { useActiveChild } from '../context/ActiveChildContext';
import { useWaliFeatures } from '../hooks/useWaliFeatures';
import { FINANCE_FEATURE_KEYS, MONITORING_FEATURE_KEYS, hasAnyFeature } from '../utils/unitFeatures';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ICONS = {
  Beranda: { active: 'home', inactive: 'home-outline' },
  Pengumuman: { active: 'megaphone', inactive: 'megaphone-outline' },
  Monitoring: { active: 'pulse', inactive: 'pulse-outline' },
  Keuangan: { active: 'wallet', inactive: 'wallet-outline' },
  Profil: { active: 'person', inactive: 'person-outline' },
};

function tabIcon(name) {
  const icons = TAB_ICONS[name];
  return function TabBarIcon({ color, focused, size }) {
    return (
    <Ionicons
      name={focused ? icons.active : icons.inactive}
      size={size ?? 22}
      color={color}
    />
    );
  };
}

function MainStack() {
  return (
    <Stack.Navigator screenOptions={stackHeaderOptions}>
      <Stack.Screen
        name="MainTabs"
        component={MainTabsInner}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AnakPilih"
        component={AnakPilihScreen}
        options={{ title: 'Pilih Anak' }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: 'Notifikasi' }}
      />
    </Stack.Navigator>
  );
}

function MainTabsInner() {
  const insets = useSafeAreaInsets();
  const tabOptions = buildTabBarScreenOptions(insets);
  const { activeChild } = useActiveChild();
  const { features } = useWaliFeatures(activeChild);
  const showMonitoring = hasAnyFeature(features, MONITORING_FEATURE_KEYS);
  const showKeuangan = hasAnyFeature(features, FINANCE_FEATURE_KEYS);

  return (
    <Tab.Navigator screenOptions={tabOptions}>
      <Tab.Screen
        name="Beranda"
        component={DashboardScreen}
        options={{
          title: 'Beranda',
          tabBarIcon: tabIcon('Beranda'),
          headerShown: false,
        }}
      />
      {features.pengumuman === true ? <Tab.Screen
        name="Pengumuman"
        component={PengumumanStack}
        options={{
          title: 'Pengumuman',
          tabBarIcon: tabIcon('Pengumuman'),
          headerShown: false,
        }}
      /> : null}
      {showMonitoring ? <Tab.Screen
        name="Monitoring"
        component={MonitoringStack}
        options={{
          title: 'Monitoring',
          tabBarIcon: tabIcon('Monitoring'),
          headerShown: false,
        }}
      /> : null}
      {showKeuangan ? <Tab.Screen
        name="Keuangan"
        component={KeuanganStack}
        options={{
          title: 'Keuangan',
          tabBarIcon: tabIcon('Keuangan'),
          headerShown: false,
        }}
      /> : null}
      <Tab.Screen
        name="Profil"
        component={ProfilStack}
        options={{
          title: 'Profil',
          tabBarIcon: tabIcon('Profil'),
          headerShown: false,
        }}
      />
    </Tab.Navigator>
  );
}

export { MainStack as MainTabs };
