import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { HomeScreen } from './screens/HomeScreen';
import { TestScreen } from './screens/TestScreen';
import { useJarvis } from './hooks/useJarvis';

export default function App() {
  const [showTestScreen, setShowTestScreen] = useState(false);
  const jarvis = useJarvis();

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      {showTestScreen
        ? <TestScreen onBack={() => setShowTestScreen(false)} jarvis={jarvis} />
        : <HomeScreen onDevMode={() => setShowTestScreen(true)} jarvis={jarvis} />}
    </>
  );
}
