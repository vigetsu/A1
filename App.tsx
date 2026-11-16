import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, PermissionsAndroid, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { getApiKey, setApiKey } from './src/lib/ai';
import * as db from './src/lib/db';
import { flag, groupPhotos, type CountryGroup, type Photo } from './src/lib/logic';
import { processAsset, removePhotoFile, type ProcessResult } from './src/lib/pipeline';

const C = {
  bg: '#F6F4EF', card: '#FFFFFF', text: '#1D2433', muted: '#6B7280', accent: '#1F6FEB',
  border: '#E5E1D8', danger: '#C2410C', ok: '#15803D',
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [country, setCountry] = useState<string | null>(null);
  const [detail, setDetail] = useState<Photo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ProcessResult[]>([]);
  const [useGps, setUseGps] = useState(true);
  const [aiForGps, setAiForGps] = useState(true);
  const [hasKey, setHasKey] = useState(true);

  const reload = useCallback(async () => setPhotos(await db.allPhotos()), []);
  useEffect(() => {
    reload();
    getApiKey().then((k) => setHasKey(!!k));
  }, [reload]);

  const groups = useMemo(() => groupPhotos(photos), [photos]);
  const current = groups.find((g) => g.country === country) ?? null;
  const cityCount = new Set(photos.filter((p) => p.city).map((p) => `${p.country}|${p.city}`)).size;

  async function addPhotos(camera: boolean) {
    // Yükleme için galeri izni istenmez: sistem seçicisi açılır ve uygulama yalnızca
    // kullanıcının seçtiği fotoğrafları görür. Kamera için kamera izni gerekir.
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('İzin gerekli', 'Kamera izni verilmedi.');
        return;
      }
    }
    if (Platform.OS === 'android' && Number(Platform.Version) >= 29) {
      // Android 10+: bu izin olmadan galerideki fotoğrafların GPS bilgisi gizlenir
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION).catch(() => null);
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], exif: true, quality: 1 };
    const res = camera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: 30 });
    if (res.canceled || !res.assets.length) return;

    setResults([]);
    setBusy({ done: 0, total: res.assets.length });
    const out: ProcessResult[] = [];
    for (const asset of res.assets) {
      out.push(await processAsset(asset, { useGps, aiForGps }));
      setBusy({ done: out.length, total: res.assets.length });
      setResults([...out]);
      await reload();
    }
    setBusy(null);
  }

  async function onDelete(p: Photo) {
    await db.deletePhoto(p.id);
    removePhotoFile(p.uri);
    setDetail(null);
    await reload();
  }

  async function onSaveLocation(p: Photo, newCountry: string, newCity: string) {
    if (!newCountry.trim()) return;
    await db.updateLocation(p.id, newCountry, newCity);
    setDetail(null);
    await reload();
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        {current ? (
          <Pressable onPress={() => setCountry(null)} hitSlop={12}>
            <Text style={s.back}>‹ Ülkeler</Text>
          </Pressable>
        ) : (
          <Text style={s.title}>🌍 Gezi Albümü</Text>
        )}
        <Pressable onPress={() => setSettingsOpen(true)} hitSlop={12}>
          <Text style={s.gear}>⚙️</Text>
        </Pressable>
      </View>

      {!hasKey && (
        <Pressable style={s.warn} onPress={() => setSettingsOpen(true)}>
          <Text style={s.warnText}>
            Ücretsiz mod: GPS'li fotoğraflar otomatik yerleşir, GPS'sizler “Konumu bilinmeyen” bölümüne düşer.
            Yapay zekâ için Ayarlar'dan API anahtarı ekleyebilirsin.
          </Text>
        </Pressable>
      )}

      {current ? (
        <CountryView group={current} onOpen={setDetail} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.country}
          contentContainerStyle={{ padding: 16, paddingBottom: 160 }}
          ListHeaderComponent={
            <View style={s.stats}>
              <Stat label="Fotoğraf" value={photos.length} />
              <Stat label="Ülke" value={groups.length} />
              <Stat label="Şehir" value={cityCount} />
            </View>
          }
          ListEmptyComponent={
            <Text style={s.empty}>
              Albüm henüz boş.{'\n'}Aşağıdan fotoğraf yükle; yapay zekâ ülke ve şehri kendisi bulsun. ✈️
            </Text>
          }
          renderItem={({ item }) => <CountryCard group={item} onPress={() => setCountry(item.country)} />}
        />
      )}

      <SafeAreaView edges={['bottom']} style={s.bottom}>
        {busy ? (
          <View style={s.busy}>
            <ActivityIndicator color={C.accent} />
            <Text style={s.busyText}>Fotoğraflar inceleniyor… {busy.done}/{busy.total}</Text>
          </View>
        ) : results.length > 0 ? (
          <Pressable onPress={() => setResults([])} style={s.results}>
            <ScrollView style={{ maxHeight: 110 }}>
              {results.map((r, i) => (
                <Text
                  key={i}
                  style={[s.resultLine, { color: r.status === 'hata' ? C.danger : r.status === 'eklendi' ? C.ok : C.muted }]}
                >
                  {r.status === 'hata' ? '⚠️ ' : ''}{r.message}
                </Text>
              ))}
            </ScrollView>
            <Text style={s.dismiss}>Kapatmak için dokun</Text>
          </Pressable>
        ) : null}
        <View style={s.actions}>
          <Pressable style={[s.btn, s.btnPrimary]} onPress={() => addPhotos(false)} disabled={!!busy}>
            <Text style={s.btnPrimaryText}>📤 Fotoğraf yükle</Text>
          </Pressable>
          <Pressable style={s.btn} onPress={() => addPhotos(true)} disabled={!!busy}>
            <Text style={s.btnText}>📷 Çek</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <PhotoModal photo={detail} onClose={() => setDetail(null)} onDelete={onDelete} onSave={onSaveLocation} />
      <SettingsModal
        visible={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          getApiKey().then((k) => setHasKey(!!k));
        }}
        useGps={useGps}
        setUseGps={setUseGps}
        aiForGps={aiForGps}
        setAiForGps={setAiForGps}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function CountryCard({ group, onPress }: { group: CountryGroup; onPress: () => void }) {
  return (
    <Pressable style={s.countryCard} onPress={onPress}>
      <Image source={{ uri: group.cover.uri }} style={s.cover} />
      <View style={s.countryInfo}>
        <Text style={s.countryName}>{flag(group.countryCode)} {group.country}</Text>
        <Text style={s.muted} numberOfLines={1}>{group.cities.map((c) => c.city).join(' · ')}</Text>
        <Text style={s.muted}>{group.count} fotoğraf</Text>
      </View>
      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

function CountryView({ group, onOpen }: { group: CountryGroup; onOpen: (p: Photo) => void }) {
  const { width } = useWindowDimensions();
  const size = Math.floor((width - 16 * 2 - 6 * 2) / 3);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>
      <Text style={s.countryTitle}>{flag(group.countryCode)} {group.country}</Text>
      <Text style={[s.muted, { marginBottom: 12 }]}>{group.count} fotoğraf · {group.cities.length} şehir</Text>
      {group.cities.map(({ city, photos }) => (
        <View key={city} style={{ marginBottom: 20 }}>
          <Text style={s.cityTitle}>🏙️ {city} <Text style={s.muted}>({photos.length})</Text></Text>
          <View style={s.grid}>
            {photos.map((p) => (
              <Pressable key={p.id} onPress={() => onOpen(p)}>
                <Image source={{ uri: p.uri }} style={{ width: size, height: size, borderRadius: 8 }} />
                {p.source === 'ai' && <Text style={s.badge}>🤖</Text>}
                {p.source === 'bilinmiyor' && <Text style={s.badge}>❓</Text>}
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function PhotoModal({ photo, onClose, onDelete, onSave }: {
  photo: Photo | null;
  onClose: () => void;
  onDelete: (p: Photo) => void;
  onSave: (p: Photo, country: string, city: string) => void;
}) {
  const [countryText, setCountryText] = useState('');
  const [cityText, setCityText] = useState('');
  useEffect(() => {
    setCountryText(photo?.country ?? '');
    setCityText(photo?.city ?? '');
  }, [photo]);
  if (!photo) return null;
  const sourceLabel = { gps: '📍 GPS ile bulundu', ai: '🤖 Yapay zekâ tahmini', manuel: '✏️ Elle düzenlendi', bilinmiyor: '❓ Konum bulunamadı — aşağıdan elle gir' }[photo.source];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          <Pressable onPress={onClose} hitSlop={12} style={{ alignSelf: 'flex-end' }}>
            <Text style={s.back}>Kapat</Text>
          </Pressable>
          <Image source={{ uri: photo.uri }} style={s.detailImage} resizeMode="contain" />
          <Text style={s.countryTitle}>
            {flag(photo.countryCode)} {[photo.city, photo.country].filter(Boolean).join(', ')}
          </Text>
          <Text style={s.muted}>
            {sourceLabel}
            {photo.source === 'ai' && photo.confidence != null ? ` · %${Math.round(photo.confidence * 100)} emin` : ''}
          </Text>
          {photo.landmark ? <Text style={s.detailLine}>🏛️ {photo.landmark}</Text> : null}
          {photo.description ? <Text style={s.detailLine}>{photo.description}</Text> : null}
          {photo.reasoning && (photo.source === 'ai' || photo.source === 'bilinmiyor') ? (
            <Text style={[s.muted, { marginTop: 6 }]}>Gerekçe: {photo.reasoning}</Text>
          ) : null}
          {photo.takenAt ? <Text style={[s.muted, { marginTop: 6 }]}>Çekim: {photo.takenAt.replace('T', ' ')}</Text> : null}

          <Text style={s.section}>Konumu düzelt</Text>
          <TextInput style={s.input} value={countryText} onChangeText={setCountryText} placeholder="Ülke" />
          <TextInput style={s.input} value={cityText} onChangeText={setCityText} placeholder="Şehir" />
          <Pressable style={[s.btn, s.btnPrimary, { marginTop: 8 }]} onPress={() => onSave(photo, countryText, cityText)}>
            <Text style={s.btnPrimaryText}>Kaydet</Text>
          </Pressable>
          <Pressable
            style={[s.btn, { marginTop: 12, borderColor: C.danger }]}
            onPress={() =>
              Alert.alert('Fotoğraf silinsin mi?', 'Albümden kaldırılır. Telefon galerindeki asıl fotoğraf silinmez.', [
                { text: 'Vazgeç', style: 'cancel' },
                { text: 'Sil', style: 'destructive', onPress: () => onDelete(photo) },
              ])
            }
          >
            <Text style={[s.btnText, { color: C.danger }]}>Albümden sil</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SettingsModal({ visible, onClose, useGps, setUseGps, aiForGps, setAiForGps }: {
  visible: boolean;
  onClose: () => void;
  useGps: boolean;
  setUseGps: (v: boolean) => void;
  aiForGps: boolean;
  setAiForGps: (v: boolean) => void;
}) {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (visible) getApiKey().then((k) => { setSaved(!!k); setKey(''); });
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16 }}>
        <View style={[s.header, { paddingHorizontal: 0 }]}>
          <Text style={s.title}>Ayarlar</Text>
          <Pressable onPress={onClose} hitSlop={12}><Text style={s.back}>Bitti</Text></Pressable>
        </View>

        <Text style={s.section}>Claude API anahtarı</Text>
        <Text style={s.muted}>
          {saved ? '✅ Anahtar kayıtlı. Değiştirmek için yenisini girin.' : 'console.anthropic.com adresinden alın.'}
          {' '}Anahtar yalnızca bu telefonun güvenli deposunda saklanır.
        </Text>
        <TextInput
          style={s.input}
          value={key}
          onChangeText={setKey}
          placeholder="sk-ant-…"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            style={[s.btn, s.btnPrimary]}
            onPress={async () => {
              if (!key.trim()) return;
              await setApiKey(key);
              setSaved(true);
              setKey('');
            }}
          >
            <Text style={s.btnPrimaryText}>Kaydet</Text>
          </Pressable>
          {saved && (
            <Pressable style={[s.btn, { flex: 1 }]} onPress={async () => { await setApiKey(''); setSaved(false); }}>
              <Text style={s.btnText}>Anahtarı sil</Text>
            </Pressable>
          )}
        </View>

        <Text style={s.section}>Konum tespiti</Text>
        <SettingRow
          label="Varsa GPS konumunu kullan"
          hint="Fotoğrafta konum bilgisi varsa en kesin sonuç budur."
          value={useGps}
          onChange={setUseGps}
        />
        <SettingRow
          label="GPS'li fotoğraflara da AI açıklaması ekle"
          hint="Kapatırsan GPS'li fotoğraflar için yapay zekâ çağrılmaz (daha ucuz)."
          value={aiForGps}
          onChange={setAiForGps}
        />
      </ScrollView>
    </Modal>
  );
}

function SettingRow({ label, hint, value, onChange }: {
  label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.muted}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 26, fontWeight: '800', color: C.text },
  back: { fontSize: 17, color: C.accent, fontWeight: '600' },
  gear: { fontSize: 22 },
  warn: { marginHorizontal: 16, padding: 12, borderRadius: 12, backgroundColor: '#E0ECFF' },
  warnText: { color: '#1E3A8A' },
  stats: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border },
  statValue: { fontSize: 24, fontWeight: '800', color: C.text },
  statLabel: { color: C.muted, marginTop: 2 },
  empty: { textAlign: 'center', color: C.muted, marginTop: 60, fontSize: 16, lineHeight: 24 },
  countryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 16, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  cover: { width: 72, height: 72, borderRadius: 12, backgroundColor: C.border },
  countryInfo: { flex: 1, marginLeft: 12, gap: 2 },
  countryName: { fontSize: 18, fontWeight: '700', color: C.text },
  chevron: { fontSize: 28, color: C.muted, paddingHorizontal: 6 },
  muted: { color: C.muted },
  countryTitle: { fontSize: 24, fontWeight: '800', color: C.text, marginTop: 4 },
  cityTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { position: 'absolute', right: 4, bottom: 4, fontSize: 14 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.bg, borderTopWidth: 1, borderColor: C.border, paddingHorizontal: 16, paddingTop: 10 },
  actions: { flexDirection: 'row', gap: 10, paddingBottom: 8 },
  btn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '600', color: C.text },
  btnPrimary: { flex: 1, backgroundColor: C.accent, borderColor: C.accent },
  btnPrimaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10 },
  busyText: { color: C.text },
  results: { paddingBottom: 10 },
  resultLine: { fontSize: 14, marginBottom: 2 },
  dismiss: { color: C.muted, fontSize: 12, marginTop: 4 },
  detailImage: { width: '100%', height: 320, borderRadius: 12, marginVertical: 12, backgroundColor: '#000' },
  detailLine: { color: C.text, marginTop: 6, fontSize: 15 },
  section: { fontSize: 15, fontWeight: '700', color: C.text, marginTop: 24, marginBottom: 8 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, fontSize: 16, marginVertical: 6, color: C.text },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  rowLabel: { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 2 },
});
