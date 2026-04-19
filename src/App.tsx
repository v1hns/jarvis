import React, { useState } from 'react';
import { StatusBar, View, StyleSheet } from 'react-native';
import { HomeScreen } from './screens/HomeScreen';
import { TestScreen } from './screens/TestScreen';
import { useJarvis } from './hooks/useJarvis';

export default function App() {
  const [showTestScreen, setShowTestScreen] = useState(false);
  const jarvis = useJarvis();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" translucent={false} />
      {showTestScreen
        ? <TestScreen onBack={() => setShowTestScreen(false)} jarvis={jarvis} />
        : <HomeScreen onDevMode={() => setShowTestScreen(true)} jarvis={jarvis} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
});
