import { Platform } from 'react-native'

const renderApiUrl = 'https://fl-liga-backend.onrender.com'

const runtimeApiUrl = () => {
  if (!__DEV__) {
    return renderApiUrl
  }

  // En iPhone físico (Expo Go) localhost apunta al propio teléfono,
  // por eso en iOS de desarrollo usamos Render por defecto.
  if (Platform.OS === 'ios') {
    return renderApiUrl
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:4000'
  }

  return 'http://localhost:4000'
}

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim() || runtimeApiUrl()
export const ANDROID_APK_URL =
  (process.env.EXPO_PUBLIC_ANDROID_APK_URL ?? '').trim() || 'https://fl-liga-backend.onrender.com/android/fl-liga-mobile-preview.apk'
