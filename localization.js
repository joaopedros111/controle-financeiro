const LOCALES = {
    "pt-BR": "pt-BR",
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    ja: "ja-JP"
};

const MOEDAS = ["BRL", "USD", "EUR", "JPY"];

const FRASES = [
    ["Há dados locais sem confirmação remota. A cópia local foi preservada.", "Some local data has no remote confirmation. The local copy was preserved.", "Hay datos locales sin confirmación remota. Se conservó la copia local.", "Certaines données locales n’ont pas de confirmation distante. La copie locale est préservée.", "Für einige lokale Daten fehlt die Serverbestätigung. Die lokale Kopie wurde erhalten.", "サーバー未確認のローカルデータがあります。ローカルコピーは保持されています。"],
    ["Alteração concorrente preservada no histórico. Sincronizando automaticamente.", "Concurrent change preserved in history. Syncing automatically.", "Cambio simultáneo conservado en el historial. Sincronizando automáticamente.", "Modification concurrente conservée dans l’historique. Synchronisation automatique.", "Gleichzeitige Änderung im Verlauf gespeichert. Automatische Synchronisierung läuft.", "同時変更を履歴に保存しました。自動同期中です。"],
    ["O backup contém limites mensais não suportados. Nenhum dado foi importado.", "The backup contains unsupported monthly limits. No data was imported.", "La copia contiene límites mensuales no compatibles. No se importó ningún dato.", "La sauvegarde contient des limites mensuelles non prises en charge. Aucune donnée importée.", "Die Sicherung enthält nicht unterstützte Monatslimits. Es wurden keine Daten importiert.", "バックアップに未対応の月別上限があります。データはインポートされていません。"],
    ["Entre com Google antes de exportar o histórico.", "Sign in with Google before exporting history.", "Inicia sesión con Google antes de exportar el historial.", "Connectez-vous avec Google avant d’exporter l’historique.", "Melde dich vor dem Verlaufsexport mit Google an.", "履歴をエクスポートするにはGoogleでログインしてください。"],
    ["Falha ao exportar histórico.", "Failed to export history.", "Error al exportar el historial.", "Échec de l’exportation de l’historique.", "Verlauf konnte nicht exportiert werden.", "履歴のエクスポートに失敗しました。"],
    ["Offline", "Offline", "Sin conexión", "Hors ligne", "Offline", "オフライン"],
    ["Os dados desta conta sincronizam automaticamente. Alterações concorrentes ficam preservadas no histórico de recuperação.", "This account syncs automatically. Concurrent changes are preserved in recovery history.", "Esta cuenta se sincroniza automáticamente. Los cambios simultáneos se conservan en el historial de recuperación.", "Ce compte se synchronise automatiquement. Les modifications concurrentes sont conservées dans l’historique de récupération.", "Dieses Konto wird automatisch synchronisiert. Gleichzeitige Änderungen bleiben im Wiederherstellungsverlauf erhalten.", "このアカウントは自動同期されます。同時変更は復旧履歴に保存されます。"],
    ["Na conta Google, importar adiciona os dados do backup e sincroniza automaticamente, sem excluir dados ausentes do arquivo.", "With a Google account, importing adds backup data and syncs automatically without deleting data missing from the file.", "Con una cuenta Google, importar añade los datos y sincroniza automáticamente sin eliminar los datos ausentes del archivo.", "Avec un compte Google, l’importation ajoute les données et les synchronise automatiquement sans supprimer celles absentes du fichier.", "Mit einem Google-Konto werden Sicherungsdaten hinzugefügt und automatisch synchronisiert, ohne im Archiv fehlende Daten zu löschen.", "Googleアカウントでは、バックアップを追加して自動同期します。ファイルにないデータは削除しません。"],
    ["Baixar histórico", "Download history", "Descargar historial", "Télécharger l’historique", "Verlauf herunterladen", "履歴をダウンロード"],
    ["Baixa uma cópia das alterações concorrentes preservadas para recuperação.", "Downloads a copy of concurrent changes preserved for recovery.", "Descarga una copia de los cambios simultáneos conservados para recuperación.", "Télécharge une copie des modifications concurrentes conservées pour récupération.", "Lädt eine Kopie der zur Wiederherstellung gespeicherten gleichzeitigen Änderungen herunter.", "復旧用に保存された同時変更のコピーをダウンロードします。"],
    ["Backup salvo localmente. Sincronizando automaticamente.", "Backup saved locally. Syncing automatically.", "Copia guardada localmente. Sincronizando automáticamente.", "Sauvegarde enregistrée localement. Synchronisation automatique.", "Sicherung lokal gespeichert. Automatische Synchronisierung läuft.", "バックアップを端末に保存しました。自動同期中です。"],
    ["esta conta", "this account", "esta cuenta", "ce compte", "dieses Konto", "このアカウント"],
    ["Entrada removida.", "Income removed.", "Ingreso eliminado.", "Revenu supprimé.", "Einnahme entfernt.", "収入を削除しました。"],
    ["Despesa removida.", "Expense removed.", "Gasto eliminado.", "Dépense supprimée.", "Ausgabe entfernt.", "支出を削除しました。"],
    ["{0} entradas removidas.", "{0} income entries removed.", "Se eliminaron {0} ingresos.", "{0} revenus supprimés.", "{0} Einnahmen entfernt.", "収入{0}件を削除しました。"],
    ["{0} despesas removidas.", "{0} expenses removed.", "Se eliminaron {0} gastos.", "{0} dépenses supprimées.", "{0} Ausgaben entfernt.", "支出{0}件を削除しました。"],
    ["{0} lançamentos ({1} receitas, {2} despesas) · {3} categorias ·", "{0} transactions ({1} income, {2} expenses) · {3} categories ·", "{0} movimientos ({1} ingresos, {2} gastos) · {3} categorías ·", "{0} opérations ({1} revenus, {2} dépenses) · {3} catégories ·", "{0} Buchungen ({1} Einnahmen, {2} Ausgaben) · {3} Kategorien ·", "取引{0}件（収入{1}件、支出{2}件）・カテゴリ{3}件・"],
    ["Dados existentes não foram alterados; gravação automática bloqueada.", "Existing data was not changed; automatic saving is blocked.", "Los datos existentes no se modificaron; el guardado automático está bloqueado.", "Les données existantes n’ont pas été modifiées ; l’enregistrement automatique est bloqué.", "Vorhandene Daten wurden nicht geändert; automatisches Speichern ist blockiert.", "既存データは変更されていません。自動保存を停止しました。"],
    ["Entradas em {0}/{1}: {2}", "Income in {0}/{1}: {2}", "Ingresos en {0}/{1}: {2}", "Revenus en {0}/{1} : {2}", "Einnahmen im {0}/{1}: {2}", "{1}年{0}の収入：{2}"],
    ["Despesas em {0}/{1}: {2}", "Expenses in {0}/{1}: {2}", "Gastos en {0}/{1}: {2}", "Dépenses en {0}/{1} : {2}", "Ausgaben im {0}/{1}: {2}", "{1}年{0}の支出：{2}"],
    ["Novo nome para a categoria “{0}”:", "New name for category “{0}”:", "Nuevo nombre para la categoría «{0}»:", "Nouveau nom pour la catégorie « {0} » :", "Neuer Name für Kategorie „{0}“:", "カテゴリ「{0}」の新しい名前："],
    ["Alterações confirmadas no armazenamento local IndexedDB.", "Changes confirmed in local IndexedDB storage.", "Cambios confirmados en el almacenamiento local IndexedDB.", "Modifications confirmées dans le stockage local IndexedDB.", "Änderungen im lokalen IndexedDB-Speicher bestätigt.", "ローカルのIndexedDBに変更を保存しました。"],
    ["Outra aba alterou os mesmos dados ou houve falha na gravação. Nenhuma sobrescrita foi aplicada. Recarregue para revisar.", "Another tab changed the same data or saving failed. Nothing was overwritten. Reload to review.", "Otra pestaña cambió los mismos datos o falló el guardado. No se sobrescribió nada. Recarga para revisar.", "Un autre onglet a modifié les mêmes données ou l’enregistrement a échoué. Rien n’a été écrasé. Rechargez pour vérifier.", "Ein anderer Tab hat dieselben Daten geändert oder das Speichern ist fehlgeschlagen. Nichts wurde überschrieben. Lade zum Prüfen neu.", "別のタブで同じデータが変更されたか、保存に失敗しました。上書きはしていません。再読み込みして確認してください。"],
    ["Vínculo já revisado em outra aba. Tente novamente para continuar.", "Linking was already reviewed in another tab. Try again to continue.", "El vínculo ya se revisó en otra pestaña. Vuelve a intentarlo para continuar.", "La liaison a déjà été vérifiée dans un autre onglet. Réessayez pour continuer.", "Die Verknüpfung wurde bereits in einem anderen Tab geprüft. Versuche es erneut, um fortzufahren.", "別のタブで連携が確認されています。続行するには再試行してください。"],
    ["As categorias ou os orçamentos diferem. OK mantém os deste dispositivo; Cancelar usa os da nuvem. As duas cópias serão preservadas no registro de conflito.", "Categories or budgets differ. OK keeps this device’s settings; Cancel uses the cloud settings. Both copies will be preserved in the conflict record.", "Las categorías o los presupuestos difieren. Aceptar conserva los de este dispositivo; Cancelar usa los de la nube. Ambas copias se conservarán en el conflicto.", "Les catégories ou budgets diffèrent. OK conserve ceux de cet appareil ; Annuler utilise ceux du cloud. Les deux copies seront conservées dans le conflit.", "Kategorien oder Budgets unterscheiden sich. OK behält die Einstellungen dieses Geräts; Abbrechen verwendet die Cloud-Einstellungen. Beide Kopien werden im Konflikt gespeichert.", "カテゴリまたは予算が異なります。OKでこの端末の設定を保持し、キャンセルでクラウドの設定を使います。両方のコピーを競合記録に保持します。"],
    ["Restaurar o backup? Todos os dados atuais serão substituídos.", "Restore the backup? All current data will be replaced.", "¿Restaurar la copia? Se sustituirán todos los datos actuales.", "Restaurer la sauvegarde ? Toutes les données actuelles seront remplacées.", "Sicherung wiederherstellen? Alle aktuellen Daten werden ersetzt.", "バックアップを復元しますか？現在のデータはすべて置き換えられます。"],
    ["Arquivo inválido.", "Invalid file.", "Archivo no válido.", "Fichier invalide.", "Ungültige Datei.", "無効なファイルです。"],
    ["Não foi possível salvar a preferência de sincronização.", "Could not save the sync preference.", "No se pudo guardar la preferencia de sincronización.", "Impossible d’enregistrer la préférence de synchronisation.", "Die Synchronisierungseinstellung konnte nicht gespeichert werden.", "同期の設定を保存できませんでした。"],
    ["Os totais mensais excedem o limite monetário seguro.", "Monthly totals exceed the safe monetary limit.", "Los totales mensuales superan el límite monetario seguro.", "Les totaux mensuels dépassent la limite monétaire sûre.", "Die Monatssummen überschreiten die sichere Betragsgrenze.", "月間合計が安全な金額の上限を超えています。"],
    ["Atualizado para a versão {0}.", "Updated to version {0}.", "Actualizado a la versión {0}.", "Mis à jour vers la version {0}.", "Auf Version {0} aktualisiert.", "バージョン{0}に更新しました。"],
    ["Atualização não confirmada: os arquivos carregados não correspondem ao Service Worker ativo.", "Update not confirmed: loaded files do not match the active Service Worker.", "Actualización no confirmada: los archivos cargados no corresponden al Service Worker activo.", "Mise à jour non confirmée : les fichiers chargés ne correspondent pas au Service Worker actif.", "Update nicht bestätigt: Geladene Dateien entsprechen nicht dem aktiven Service Worker.", "更新を確認できませんでした。読み込まれたファイルと有効なService Workerが一致しません。"],
    ["Atualização {0} disponível; atualização adiada pelo usuário.", "Update {0} available; postponed by the user.", "Actualización {0} disponible; aplazada por el usuario.", "Mise à jour {0} disponible ; reportée par l’utilisateur.", "Update {0} verfügbar; vom Benutzer verschoben.", "更新{0}があります。ユーザーにより延期されました。"],
    ["Aplicativo atualizado na versão {0}.", "App up to date at version {0}.", "Aplicación actualizada a la versión {0}.", "Application à jour avec la version {0}.", "App auf Version {0} aktuell.", "アプリは最新のバージョン{0}です。"],
    ["Falha na verificação: {0}.", "Check failed: {0}.", "Falló la comprobación: {0}.", "Échec de la vérification : {0}.", "Prüfung fehlgeschlagen: {0}.", "確認に失敗しました：{0}。"],
    ["Dados antigos migrados para {0}; confira os meses.", "Old data migrated to {0}; check the months.", "Datos antiguos migrados a {0}; comprueba los meses.", "Anciennes données migrées vers {0} ; vérifiez les mois.", "Alte Daten nach {0} migriert; prüfe die Monate.", "古いデータを{0}年に移行しました。各月を確認してください。"],
    ["Dados da versão anterior atualizados; os backups antigos continuam compatíveis.", "Previous-version data updated; old backups remain compatible.", "Datos de la versión anterior actualizados; las copias antiguas siguen siendo compatibles.", "Données de la version précédente mises à jour ; les anciennes sauvegardes restent compatibles.", "Daten der vorherigen Version aktualisiert; alte Sicherungen bleiben kompatibel.", "旧バージョンのデータを更新しました。古いバックアップも引き続き利用できます。"],
    ["Dados salvos em uma versão anterior do armazenamento foram migrados.", "Data saved in a previous storage version was migrated.", "Se migraron los datos guardados en una versión anterior del almacenamiento.", "Les données enregistrées dans une version précédente du stockage ont été migrées.", "In einer früheren Speicherversion gesicherte Daten wurden migriert.", "以前のストレージ形式のデータを移行しました。"],
    ["Homologação IndexedDB bloqueada: não edite dados até recuperar o armazenamento.", "IndexedDB testing blocked: do not edit data until storage is recovered.", "Prueba IndexedDB bloqueada: no edites datos hasta recuperar el almacenamiento.", "Test IndexedDB bloqué : ne modifiez pas les données avant la récupération du stockage.", "IndexedDB-Test blockiert: Bearbeite keine Daten, bis der Speicher wiederhergestellt ist.", "IndexedDBテストを停止しました。ストレージの復旧までデータを編集しないでください。"],
    ["Modo experimental IndexedDB ativo neste navegador. Não use com dados reais ou abas da versão anterior; Firebase desativado.", "Experimental IndexedDB mode is active in this browser. Do not use real data or tabs running the previous version; Firebase is disabled.", "Modo experimental IndexedDB activo. No uses datos reales ni pestañas de la versión anterior; Firebase está desactivado.", "Mode expérimental IndexedDB actif. N’utilisez pas de données réelles ni d’onglets de la version précédente ; Firebase est désactivé.", "Experimenteller IndexedDB-Modus aktiv. Verwende keine echten Daten oder Tabs der vorherigen Version; Firebase ist deaktiviert.", "このブラウザーで実験用IndexedDBモードが有効です。実データや旧バージョンのタブを使わないでください。Firebaseは無効です。"],
    ["Novo nome para {0}:", "New name for {0}:", "Nuevo nombre para {0}:", "Nouveau nom pour {0} :", "Neuer Name für {0}:", "「{0}」の新しい名前："],
    ["Despesas por categoria em", "Expenses by category in", "Gastos por categoría en", "Dépenses par catégorie en", "Ausgaben nach Kategorie im", "カテゴリ別支出："],
    ["orçamento excedido", "budget exceeded", "presupuesto superado", "budget dépassé", "Budget überschritten", "予算超過"],
    ["sim", "yes", "sí", "oui", "ja", "はい"],
    ["não", "no", "no", "non", "nein", "いいえ"],
    ["Primeiro vínculo com {0}.\n\nNeste dispositivo: {1} lançamentos.\nNa nuvem: {2}.\nPossíveis duplicidades, que serão mantidas: {3}.\nConflitos de mesmo ID, preservados dos dois lados: {4}.\nConfigurações financeiras na nuvem: {5}.\n\nSerá guardado um backup local antes da combinação. Continuar?", "First link with {0}.\n\nOn this device: {1} transactions.\nIn the cloud: {2}.\nPossible duplicates, which will be kept: {3}.\nSame-ID conflicts, preserved on both sides: {4}.\nFinancial settings in the cloud: {5}.\n\nA local backup will be saved before merging. Continue?", "Primer vínculo con {0}.\n\nEn este dispositivo: {1} movimientos.\nEn la nube: {2}.\nPosibles duplicados, que se conservarán: {3}.\nConflictos del mismo ID, conservados en ambos lados: {4}.\nConfiguración financiera en la nube: {5}.\n\nSe guardará una copia local antes de combinar. ¿Continuar?", "Première liaison avec {0}.\n\nSur cet appareil : {1} opérations.\nDans le cloud : {2}.\nDoublons possibles qui seront conservés : {3}.\nConflits de même ID, préservés des deux côtés : {4}.\nParamètres financiers dans le cloud : {5}.\n\nUne sauvegarde locale sera enregistrée avant la fusion. Continuer ?", "Erste Verknüpfung mit {0}.\n\nAuf diesem Gerät: {1} Buchungen.\nIn der Cloud: {2}.\nMögliche Duplikate, die erhalten bleiben: {3}.\nKonflikte mit gleicher ID, beidseitig erhalten: {4}.\nFinanzeinstellungen in der Cloud: {5}.\n\nVor dem Abgleich wird eine lokale Sicherung erstellt. Fortfahren?", "{0}と初めて連携します。\n\nこの端末：取引{1}件。\nクラウド：{2}件。\n保持する重複候補：{3}件。\n両方を保持する同一IDの競合：{4}件。\nクラウドの家計設定：{5}。\n\n統合前にローカルバックアップを保存します。続行しますか？"],
    ["Uma nova versão do Controle Financeiro está disponível.\n\nVersão instalada: {0}\nVersão disponível: {1}\n\nDeseja atualizar agora?", "A new version of Financial Manager is available.\n\nInstalled version: {0}\nAvailable version: {1}\n\nUpdate now?", "Hay una nueva versión de Control financiero.\n\nVersión instalada: {0}\nVersión disponible: {1}\n\n¿Actualizar ahora?", "Une nouvelle version de Gestion financière est disponible.\n\nVersion installée : {0}\nVersion disponible : {1}\n\nMettre à jour maintenant ?", "Eine neue Version der Finanzverwaltung ist verfügbar.\n\nInstallierte Version: {0}\nVerfügbare Version: {1}\n\nJetzt aktualisieren?", "家計管理の新しいバージョンがあります。\n\nインストール済み：{0}\n利用可能：{1}\n\n今すぐ更新しますか？"],
    ["Atualização disponível: {0} → {1}.", "Update available: {0} → {1}.", "Actualización disponible: {0} → {1}.", "Mise à jour disponible : {0} → {1}.", "Update verfügbar: {0} → {1}.", "更新があります：{0} → {1}。"],
    ["Aplicativo atualizado para a versão {0}.", "App updated to version {0}.", "Aplicación actualizada a la versión {0}.", "Application mise à jour vers la version {0}.", "App auf Version {0} aktualisiert.", "バージョン{0}に更新しました。"],
    ["Não foi possível carregar os metadados da versão instalada: {0}.", "Could not load installed version metadata: {0}.", "No se pudieron cargar los metadatos de la versión instalada: {0}.", "Impossible de charger les métadonnées de la version installée : {0}.", "Metadaten der installierten Version konnten nicht geladen werden: {0}.", "インストール済みバージョンの情報を読み込めませんでした：{0}。"],
    ["A versão {0} está disponível. A atualização foi adiada.", "Version {0} is available. The update was postponed.", "La versión {0} está disponible. Se aplazó la actualización.", "La version {0} est disponible. La mise à jour a été reportée.", "Version {0} ist verfügbar. Das Update wurde verschoben.", "バージョン{0}があります。更新を延期しました。"],
    ["Arquivos da versão {0} assumiram o controle. Confirmando a interface após recarregar…", "Version {0} files took control. Confirming the interface after reload…", "Los archivos de la versión {0} tomaron el control. Confirmando la interfaz tras recargar…", "Les fichiers de la version {0} ont pris le contrôle. Confirmation de l’interface après rechargement…", "Dateien der Version {0} haben die Steuerung übernommen. Oberfläche wird nach dem Neuladen bestätigt…", "バージョン{0}のファイルに切り替わりました。再読み込み後の画面を確認中…"],
    ["Versão {0} disponível. Você pode verificar novamente quando quiser.", "Version {0} available. You can check again at any time.", "Versión {0} disponible. Puedes volver a comprobar cuando quieras.", "Version {0} disponible. Vous pouvez vérifier à nouveau à tout moment.", "Version {0} verfügbar. Du kannst jederzeit erneut prüfen.", "バージョン{0}があります。いつでも再確認できます。"],
    ["O aplicativo já está atualizado na versão {0}.", "The app is already up to date at version {0}.", "La aplicación ya está actualizada a la versión {0}.", "L’application est déjà à jour avec la version {0}.", "Die App ist bereits auf Version {0} aktuell.", "アプリは最新のバージョン{0}です。"],
    ["Não foi possível concluir a verificação. {0}", "Could not complete the check. {0}", "No se pudo completar la comprobación. {0}", "Impossible de terminer la vérification. {0}", "Die Prüfung konnte nicht abgeschlossen werden. {0}", "確認を完了できませんでした。{0}"],
    ["Não foi possível verificar a atualização. {0}", "Could not check for updates. {0}", "No se pudo buscar la actualización. {0}", "Impossible de vérifier la mise à jour. {0}", "Die Aktualisierung konnte nicht geprüft werden. {0}", "更新を確認できませんでした。{0}"],
    ["Tente novamente quando houver conexão.", "Try again when you are online.", "Vuelve a intentarlo cuando haya conexión.", "Réessayez lorsque vous serez en ligne.", "Versuche es erneut, wenn eine Verbindung besteht.", "オンラインになってから再試行してください。"],
    ["Você está offline; não foi possível verificar a versão publicada.", "You are offline; the published version could not be checked.", "Estás sin conexión; no se pudo comprobar la versión publicada.", "Vous êtes hors ligne ; impossible de vérifier la version publiée.", "Du bist offline; die veröffentlichte Version konnte nicht geprüft werden.", "オフラインのため、公開バージョンを確認できませんでした。"],
    ["Este navegador não oferece atualização por Service Worker.", "This browser does not support Service Worker updates.", "Este navegador no admite actualizaciones mediante Service Worker.", "Ce navigateur ne prend pas en charge les mises à jour par Service Worker.", "Dieser Browser unterstützt keine Aktualisierung über Service Worker.", "このブラウザーはService Workerによる更新に対応していません。"],
    ["O Service Worker deste aplicativo ainda não foi registrado.", "This app’s Service Worker has not been registered yet.", "Aún no se ha registrado el Service Worker de esta aplicación.", "Le Service Worker de cette application n’est pas encore enregistré.", "Der Service Worker dieser App wurde noch nicht registriert.", "このアプリのService Workerはまだ登録されていません。"],
    ["A versão {0} não foi confirmada como controladora do aplicativo.", "Version {0} was not confirmed as controlling the app.", "No se confirmó que la versión {0} controle la aplicación.", "La version {0} n’a pas été confirmée comme contrôlant l’application.", "Version {0} wurde nicht als steuernde App-Version bestätigt.", "バージョン{0}がアプリを制御していると確認できませんでした。"],
    ["Service Worker instalando ({0}).", "Service Worker installing ({0}).", "Service Worker instalándose ({0}).", "Service Worker en cours d’installation ({0}).", "Service Worker wird installiert ({0}).", "Service Workerをインストール中（{0}）。"],
    ["Service Worker ativo ({0}); controlando esta página.", "Service Worker active ({0}); controlling this page.", "Service Worker activo ({0}); controlando esta página.", "Service Worker actif ({0}) ; contrôle cette page.", "Service Worker aktiv ({0}); steuert diese Seite.", "Service Worker有効（{0}）。このページを制御中。"],
    ["Service Worker ativo ({0}); a página ainda não está sob controle.", "Service Worker active ({0}); this page is not controlled yet.", "Service Worker activo ({0}); la página aún no está bajo control.", "Service Worker actif ({0}) ; cette page n’est pas encore contrôlée.", "Service Worker aktiv ({0}); diese Seite wird noch nicht gesteuert.", "Service Worker有効（{0}）。このページはまだ制御されていません。"],
    ["Não foi possível consultar o Service Worker: {0}", "Could not check the Service Worker: {0}", "No se pudo consultar el Service Worker: {0}", "Impossible de vérifier le Service Worker : {0}", "Service Worker konnte nicht abgefragt werden: {0}", "Service Workerを確認できませんでした：{0}"],
    ["Expressão inválida", "Invalid expression", "Expresión no válida", "Expression invalide", "Ungültiger Ausdruck", "無効な式"],
    ["A combinação remota excede os limites ou contém dados inválidos. A cópia local foi preservada.", "The remote merge exceeds limits or contains invalid data. The local copy was preserved.", "La combinación remota supera los límites o contiene datos no válidos. Se conservó la copia local.", "La fusion distante dépasse les limites ou contient des données invalides. La copie locale est préservée.", "Der entfernte Abgleich überschreitet Limits oder enthält ungültige Daten. Die lokale Kopie wurde erhalten.", "リモートとの統合が上限を超えているか、無効なデータを含みます。ローカルコピーは保持されています。"],
    ["Não foi possível salvar os dados remotos localmente. A cópia anterior foi preservada.", "Could not save remote data locally. The previous copy was preserved.", "No se pudieron guardar localmente los datos remotos. Se conservó la copia anterior.", "Impossible d’enregistrer les données distantes localement. La copie précédente est préservée.", "Entfernte Daten konnten nicht lokal gespeichert werden. Die vorherige Kopie wurde erhalten.", "リモートデータをローカルに保存できませんでした。以前のコピーは保持されています。"],
    ["Há conflitos remotos inválidos. A lista local foi preservada; corrija os dados na nuvem e tente novamente.", "Invalid remote conflicts found. The local list was preserved; correct the cloud data and try again.", "Hay conflictos remotos no válidos. Se conservó la lista local; corrige los datos de la nube y vuelve a intentarlo.", "Des conflits distants sont invalides. La liste locale est préservée ; corrigez les données du cloud et réessayez.", "Ungültige entfernte Konflikte gefunden. Die lokale Liste wurde erhalten; korrigiere die Cloud-Daten und versuche es erneut.", "無効なリモート競合があります。ローカル一覧は保持されています。クラウドのデータを修正して再試行してください。"],
    ["Combinar os registros do backup com os dados atuais da nuvem? Nenhum registro remoto ausente no backup será excluído.", "Merge backup records with current cloud data? Remote records missing from the backup will not be deleted.", "¿Combinar los registros de la copia con los datos actuales de la nube? No se eliminarán registros remotos ausentes de la copia.", "Fusionner les enregistrements de la sauvegarde avec les données actuelles du cloud ? Aucun enregistrement distant absent de la sauvegarde ne sera supprimé.", "Sicherungsdaten mit den aktuellen Cloud-Daten zusammenführen? Entfernte Einträge, die in der Sicherung fehlen, werden nicht gelöscht.", "バックアップの記録を現在のクラウドデータと統合しますか？バックアップにないリモート記録は削除しません。"],
    ["Sincroniza??o desativada. Os dados permanecem locais.", "Sync is off. Data remains local.", "La sincronización está desactivada. Los datos siguen en este dispositivo.", "La synchronisation est désactivée. Les données restent locales.", "Synchronisierung ist deaktiviert. Daten bleiben lokal.", "同期はオフです。データは端末に残ります。"],
    ["N?o foi poss?vel salvar a prefer?ncia de sincroniza??o.", "Could not save the sync preference.", "No se pudo guardar la preferencia de sincronización.", "Impossible d’enregistrer la préférence de synchronisation.", "Die Synchronisierungseinstellung konnte nicht gespeichert werden.", "同期の設定を保存できませんでした。"],
    ["Conflito", "Conflict", "Conflicto", "Conflit", "Konflikt", "競合"],
    ["settings", "Settings", "Configuración", "Paramètres", "Einstellungen", "設定"],
    ["record", "Record", "Registro", "Enregistrement", "Datensatz", "記録"],
    ["delete", "Deletion", "Eliminación", "Suppression", "Löschung", "削除"],
    ["Conflito inválido. Os dados locais foram preservados.", "Invalid conflict. Local data was preserved.", "Conflicto no válido. Se conservaron los datos locales.", "Conflit invalide. Les données locales sont préservées.", "Ungültiger Konflikt. Lokale Daten wurden erhalten.", "無効な競合です。ローカルデータは保持されています。"],
    ["Conflito inválido. Os dados locais e a fila foram preservados.", "Invalid conflict. Local data and the queue were preserved.", "Conflicto no válido. Se conservaron los datos locales y la cola.", "Conflit invalide. Les données locales et la file sont préservées.", "Ungültiger Konflikt. Lokale Daten und Warteschlange wurden erhalten.", "無効な競合です。ローカルデータと待機中の処理は保持されています。"],
    ["Uma exclusão não possui segunda versão para copiar. Escolha manter a exclusão ou usar a nuvem.", "A deletion has no second version to copy. Choose to keep the deletion or use the cloud.", "Una eliminación no tiene una segunda versión para copiar. Elige mantener la eliminación o usar la nube.", "Une suppression n’a pas de seconde version à copier. Choisissez de conserver la suppression ou d’utiliser le cloud.", "Eine Löschung hat keine zweite Version zum Kopieren. Behalte die Löschung oder verwende die Cloud.", "削除にはコピーする2つ目のバージョンがありません。削除を保持するか、クラウドを使ってください。"],
    ["A resolução contém dados inválidos ou excede o limite mensal. Os dados locais foram preservados.", "The resolution contains invalid data or exceeds the monthly limit. Local data was preserved.", "La resolución contiene datos no válidos o supera el límite mensual. Se conservaron los datos locales.", "La résolution contient des données invalides ou dépasse la limite mensuelle. Les données locales sont préservées.", "Die Auflösung enthält ungültige Daten oder überschreitet das Monatslimit. Lokale Daten wurden erhalten.", "解決内容に無効なデータがあるか、月間上限を超えています。ローカルデータは保持されています。"],
    ["Não foi possível salvar a resolução. A cópia local e o conflito foram preservados.", "Could not save the resolution. The local copy and conflict were preserved.", "No se pudo guardar la resolución. Se conservaron la copia local y el conflicto.", "Impossible d’enregistrer la résolution. La copie locale et le conflit sont préservés.", "Die Auflösung konnte nicht gespeichert werden. Lokale Kopie und Konflikt wurden erhalten.", "解決内容を保存できませんでした。ローカルコピーと競合は保持されています。"],
    ["A escolha foi salva localmente, mas não foi possível confirmar a resolução na nuvem. Tente novamente.", "Your choice was saved locally, but the cloud resolution could not be confirmed. Try again.", "La elección se guardó localmente, pero no se pudo confirmar la resolución en la nube. Vuelve a intentarlo.", "Votre choix a été enregistré localement, mais la résolution dans le cloud n’a pas pu être confirmée. Réessayez.", "Die Auswahl wurde lokal gespeichert, aber die Cloud-Auflösung konnte nicht bestätigt werden. Versuche es erneut.", "選択をローカルに保存しましたが、クラウドでの解決を確認できませんでした。再試行してください。"],
    ["A escolha continua pendente; o conflito foi preservado até a confirmação das configurações.", "Your choice is still pending; the conflict is preserved until settings are confirmed.", "La elección sigue pendiente; el conflicto se conserva hasta confirmar la configuración.", "Votre choix reste en attente ; le conflit est conservé jusqu’à la confirmation des paramètres.", "Die Auswahl steht noch aus; der Konflikt bleibt bis zur Bestätigung der Einstellungen erhalten.", "選択は保留中です。設定が確認されるまで競合を保持します。"],
    ["Restaurar o backup? Todos os dados atuais serao substituidos.", "Restore the backup? All current data will be replaced.", "¿Restaurar la copia? Se sustituirán todos los datos actuales.", "Restaurer la sauvegarde ? Toutes les données actuelles seront remplacées.", "Sicherung wiederherstellen? Alle aktuellen Daten werden ersetzt.", "バックアップを復元しますか？現在のデータはすべて置き換えられます。"],
    ["Arquivo inválido. Escolha um backup gerado por este aplicativo.", "Invalid file. Choose a backup created by this app.", "Archivo no válido. Elige una copia creada por esta aplicación.", "Fichier invalide. Choisissez une sauvegarde créée par cette application.", "Ungültige Datei. Wähle eine von dieser App erstellte Sicherung.", "無効なファイルです。このアプリで作成したバックアップを選択してください。"],
    ["Arquivo invalido.", "Invalid file.", "Archivo no válido.", "Fichier invalide.", "Ungültige Datei.", "無効なファイルです。"],
    ["Falha ao persistir; dados anteriores preservados.", "Saving failed; previous data was preserved.", "Falló el guardado; se conservaron los datos anteriores.", "Échec de l’enregistrement ; les données précédentes sont préservées.", "Speichern fehlgeschlagen; vorherige Daten wurden erhalten.", "保存に失敗しました。以前のデータは保持されています。"],
    ["Backup restaurado, mas o armazenamento persistente falhou; os dados podem se perder ao fechar o app.", "Backup restored, but persistent storage failed; data may be lost when the app closes.", "Copia restaurada, pero falló el almacenamiento persistente; los datos podrían perderse al cerrar la aplicación.", "Sauvegarde restaurée, mais le stockage persistant a échoué ; les données risquent d’être perdues à la fermeture.", "Sicherung wiederhergestellt, aber dauerhafter Speicher fehlgeschlagen; Daten können beim Schließen verloren gehen.", "バックアップを復元しましたが、永続ストレージでエラーが発生しました。アプリを閉じるとデータが失われる可能性があります。"],
    ["Os totais mensais excedem o limite monetário seguro. Ajuste os lançamentos antes de exportar.", "Monthly totals exceed the safe monetary limit. Adjust transactions before exporting.", "Los totales mensuales superan el límite monetario seguro. Ajusta los movimientos antes de exportar.", "Les totaux mensuels dépassent la limite monétaire sûre. Ajustez les opérations avant l’exportation.", "Die Monatssummen überschreiten die sichere Betragsgrenze. Passe die Buchungen vor dem Export an.", "月間合計が安全な金額の上限を超えています。書き出す前に取引を調整してください。"],
    ["O backup normal está bloqueado porque os dados financeiros precisam ser recuperados. Baixe a cópia preservada ou restaure um backup válido.", "Normal backup is blocked because financial data needs recovery. Download the preserved copy or restore a valid backup.", "La copia normal está bloqueada porque los datos financieros requieren recuperación. Descarga la copia conservada o restaura una copia válida.", "La sauvegarde normale est bloquée car les données financières doivent être récupérées. Téléchargez la copie préservée ou restaurez une sauvegarde valide.", "Die normale Sicherung ist blockiert, da Finanzdaten wiederhergestellt werden müssen. Lade die erhaltene Kopie herunter oder stelle eine gültige Sicherung wieder her.", "家計データの復旧が必要なため、通常のバックアップは停止しています。保持されたコピーをダウンロードするか、有効なバックアップを復元してください。"],
    ["Backup JSON gerado em {0}.", "JSON backup created on {0}.", "Copia JSON creada el {0}.", "Sauvegarde JSON créée le {0}.", "JSON-Sicherung erstellt am {0}.", "JSONバックアップ作成日時：{0}。"],
    ["Backup restaurado em {0}.", "Backup restored on {0}.", "Copia restaurada el {0}.", "Sauvegarde restaurée le {0}.", "Sicherung wiederhergestellt am {0}.", "バックアップ復元日時：{0}。"],
    ["{0} lançamentos ({1} receitas, {2} despesas) · {3} categorias · {4}", "{0} transactions ({1} income, {2} expenses) · {3} categories · {4}", "{0} movimientos ({1} ingresos, {2} gastos) · {3} categorías · {4}", "{0} opérations ({1} revenus, {2} dépenses) · {3} catégories · {4}", "{0} Buchungen ({1} Einnahmen, {2} Ausgaben) · {3} Kategorien · {4}", "取引{0}件（収入{1}件、支出{2}件）・カテゴリ{3}件・{4}"],
    ["Estado do Service Worker ainda não consultado.", "Service Worker status not checked yet.", "Estado del Service Worker aún no consultado.", "État du Service Worker pas encore vérifié.", "Service-Worker-Status noch nicht abgefragt.", "Service Workerの状態はまだ確認されていません。"],
    ["Última sincronização confirmada: {0}", "Last confirmed sync: {0}", "Última sincronización confirmada: {0}", "Dernière synchronisation confirmée : {0}", "Letzte bestätigte Synchronisierung: {0}", "最後に確認された同期：{0}"],
    ["Login cancelado. Seus dados continuam neste dispositivo.", "Sign-in cancelled. Your data remains on this device.", "Inicio de sesión cancelado. Tus datos siguen en este dispositivo.", "Connexion annulée. Vos données restent sur cet appareil.", "Anmeldung abgebrochen. Deine Daten bleiben auf diesem Gerät.", "ログインをキャンセルしました。データはこの端末に残っています。"],
    ["Permita popups e tente novamente. No iPhone/iPad ou aplicativo instalado, abra este mesmo endereco no Safari ou Chrome para entrar.", "Allow popups and try again. On iPhone/iPad or in the installed app, open this address in Safari or Chrome to sign in.", "Permite las ventanas emergentes y vuelve a intentarlo. En iPhone/iPad o en la aplicación instalada, abre esta dirección en Safari o Chrome para entrar.", "Autorisez les fenêtres contextuelles et réessayez. Sur iPhone/iPad ou dans l’application installée, ouvrez cette adresse dans Safari ou Chrome pour vous connecter.", "Erlaube Pop-ups und versuche es erneut. Öffne diese Adresse auf iPhone/iPad oder in der installierten App zur Anmeldung in Safari oder Chrome.", "ポップアップを許可して再試行してください。iPhone/iPadやインストール済みアプリでは、同じアドレスをSafariまたはChromeで開いてログインしてください。"],
    ["Sem conexao com o Google. Verifique a internet e tente novamente.", "Cannot connect to Google. Check your internet connection and try again.", "Sin conexión con Google. Comprueba internet y vuelve a intentarlo.", "Impossible de joindre Google. Vérifiez votre connexion et réessayez.", "Keine Verbindung zu Google. Prüfe die Internetverbindung und versuche es erneut.", "Googleに接続できません。インターネット接続を確認して再試行してください。"],
    ["Este dominio nao esta autorizado no Firebase Authentication. Contate o responsavel pelo aplicativo.", "This domain is not authorized in Firebase Authentication. Contact the app administrator.", "Este dominio no está autorizado en Firebase Authentication. Contacta al responsable de la aplicación.", "Ce domaine n’est pas autorisé dans Firebase Authentication. Contactez le responsable de l’application.", "Diese Domain ist in Firebase Authentication nicht zugelassen. Wende dich an die App-Verwaltung.", "このドメインはFirebase Authenticationで許可されていません。アプリの管理者に連絡してください。"],
    ["O login Google nao esta habilitado neste projeto Firebase.", "Google sign-in is not enabled in this Firebase project.", "El inicio de sesión con Google no está habilitado en este proyecto Firebase.", "La connexion Google n’est pas activée dans ce projet Firebase.", "Die Google-Anmeldung ist in diesem Firebase-Projekt nicht aktiviert.", "このFirebaseプロジェクトではGoogleログインが有効になっていません。"],
    ["O navegador bloqueou o armazenamento da sessao. Abra em uma janela normal do navegador.", "The browser blocked session storage. Open a normal browser window.", "El navegador bloqueó el almacenamiento de la sesión. Abre una ventana normal del navegador.", "Le navigateur a bloqué le stockage de session. Ouvrez une fenêtre normale du navigateur.", "Der Browser hat den Sitzungsspeicher blockiert. Öffne ein normales Browserfenster.", "ブラウザーがセッションの保存をブロックしました。通常のブラウザーウィンドウで開いてください。"],
    ["Nao foi possivel entrar com Google. Tente novamente no navegador. Codigo: {0}", "Could not sign in with Google. Try again in the browser. Code: {0}", "No se pudo iniciar sesión con Google. Vuelve a intentarlo en el navegador. Código: {0}", "Impossible de se connecter avec Google. Réessayez dans le navigateur. Code : {0}", "Google-Anmeldung fehlgeschlagen. Versuche es erneut im Browser. Code: {0}", "Googleでログインできませんでした。ブラウザーで再試行してください。コード：{0}"],
    ["Aguardando entrada com Google...", "Waiting for Google sign-in…", "Esperando el inicio de sesión con Google…", "En attente de connexion Google…", "Warten auf Google-Anmeldung…", "Googleログインを待っています…"],
    ["Conectando ao Firebase...", "Connecting to Firebase…", "Conectando con Firebase…", "Connexion à Firebase…", "Verbindung mit Firebase…", "Firebaseに接続中…"],
    ["Firebase desativado no ensaio IndexedDB.", "Firebase is disabled in the IndexedDB test.", "Firebase está desactivado en la prueba IndexedDB.", "Firebase est désactivé pour le test IndexedDB.", "Firebase ist im IndexedDB-Test deaktiviert.", "IndexedDBテストではFirebaseは無効です。"],
    ["Alteracoes confirmadas no armazenamento local IndexedDB.", "Changes confirmed in local IndexedDB storage.", "Cambios confirmados en el almacenamiento local IndexedDB.", "Modifications confirmées dans le stockage local IndexedDB.", "Änderungen im lokalen IndexedDB-Speicher bestätigt.", "ローカルのIndexedDBに変更を保存しました。"],
    ["Outra aba alterou os mesmos dados ou houve falha na gravacao. Nenhuma sobrescrita foi aplicada. Recarregue para revisar.", "Another tab changed the same data or saving failed. Nothing was overwritten. Reload to review.", "Otra pestaña cambió los mismos datos o falló el guardado. No se sobrescribió nada. Recarga para revisar.", "Un autre onglet a modifié les mêmes données ou l’enregistrement a échoué. Rien n’a été écrasé. Rechargez pour vérifier.", "Ein anderer Tab hat dieselben Daten geändert oder das Speichern ist fehlgeschlagen. Nichts wurde überschrieben. Lade zum Prüfen neu.", "別のタブで同じデータが変更されたか、保存に失敗しました。上書きはしていません。再読み込みして確認してください。"],
    ["Os totais mensais excedem o limite monet?rio seguro.", "Monthly totals exceed the safe monetary limit.", "Los totales mensuales superan el límite monetario seguro.", "Les totaux mensuels dépassent la limite monétaire sûre.", "Die Monatssummen überschreiten die sichere Betragsgrenze.", "月間合計が安全な金額の上限を超えています。"],
    ["Os totais deste mês excedem o limite monetário seguro. Ajuste os lançamentos para atualizar o resumo.", "This month’s totals exceed the safe monetary limit. Adjust transactions to update the summary.", "Los totales del mes superan el límite monetario seguro. Ajusta los movimientos para actualizar el resumen.", "Les totaux du mois dépassent la limite monétaire sûre. Ajustez les opérations pour actualiser le résumé.", "Die Monatssummen überschreiten die sichere Betragsgrenze. Passe die Buchungen an, um die Übersicht zu aktualisieren.", "今月の合計が安全な金額の上限を超えています。取引を調整してサマリーを更新してください。"],
    ["Há {0} conflito(s) para revisar.", "There are {0} conflict(s) to review.", "Hay {0} conflicto(s) para revisar.", "Il y a {0} conflit(s) à examiner.", "Es gibt {0} Konflikt(e) zu prüfen.", "確認が必要な競合が{0}件あります。"],
    ["Falha na reconciliação. A fila foi preservada.", "Reconciliation failed. The queue was preserved.", "Falló la conciliación. Se conservó la cola.", "Échec du rapprochement. La file a été conservée.", "Abgleich fehlgeschlagen. Die Warteschlange wurde erhalten.", "照合に失敗しました。待機中の処理は保持されています。"],
    ["Falha no envio. Os dados locais foram preservados.", "Upload failed. Local data was preserved.", "Falló el envío. Se conservaron los datos locales.", "Échec de l’envoi. Les données locales ont été conservées.", "Upload fehlgeschlagen. Lokale Daten wurden erhalten.", "送信に失敗しました。ローカルデータは保持されています。"],
    ["Não foi possível preservar as configurações remotas. Tente novamente.", "Could not preserve remote settings. Try again.", "No se pudo conservar la configuración remota. Vuelve a intentarlo.", "Impossible de préserver les paramètres distants. Réessayez.", "Entfernte Einstellungen konnten nicht gesichert werden. Versuche es erneut.", "リモート設定を保持できませんでした。再試行してください。"],
    ["Erro ao observar configurações remotas.", "Error listening for remote settings.", "Error al observar la configuración remota.", "Erreur lors de l’écoute des paramètres distants.", "Fehler beim Beobachten entfernter Einstellungen.", "リモート設定の監視中にエラーが発生しました。"],
    ["Erro ao recuperar conflitos remotos.", "Error retrieving remote conflicts.", "Error al recuperar los conflictos remotos.", "Erreur lors de la récupération des conflits distants.", "Fehler beim Abrufen entfernter Konflikte.", "リモートの競合を取得できませんでした。"],
    ["A persistência falhou. A sincronização foi pausada; os dados locais foram preservados.", "Saving failed. Sync was paused; local data was preserved.", "Falló el guardado. Se pausó la sincronización y se conservaron los datos locales.", "Échec de l’enregistrement. La synchronisation est suspendue ; les données locales sont préservées.", "Speichern fehlgeschlagen. Synchronisierung pausiert; lokale Daten wurden erhalten.", "保存に失敗しました。同期を一時停止しました。ローカルデータは保持されています。"],
    ["Backup restaurado: confirme a combinação com a nuvem antes do envio.", "Backup restored: confirm merging with the cloud before uploading.", "Copia restaurada: confirma la combinación con la nube antes de enviar.", "Sauvegarde restaurée : confirmez la fusion avec le cloud avant l’envoi.", "Sicherung wiederhergestellt: Bestätige vor dem Upload den Abgleich mit der Cloud.", "バックアップを復元しました。送信前にクラウドとの統合を確認してください。"],
    ["As configurações remotas são inválidas. A cópia local foi preservada; corrija os dados na nuvem e tente novamente.", "Remote settings are invalid. The local copy was preserved; correct the cloud data and try again.", "La configuración remota no es válida. Se conservó la copia local; corrige los datos de la nube y vuelve a intentarlo.", "Les paramètres distants sont invalides. La copie locale est préservée ; corrigez les données du cloud et réessayez.", "Entfernte Einstellungen sind ungültig. Die lokale Kopie wurde erhalten; korrigiere die Cloud-Daten und versuche es erneut.", "リモート設定が無効です。ローカルコピーは保持されています。クラウドのデータを修正して再試行してください。"],
    ["As configurações remotas são inválidas. A cópia local foi preservada.", "Remote settings are invalid. The local copy was preserved.", "La configuración remota no es válida. Se conservó la copia local.", "Les paramètres distants sont invalides. La copie locale est préservée.", "Entfernte Einstellungen sind ungültig. Die lokale Kopie wurde erhalten.", "リモート設定が無効です。ローカルコピーは保持されています。"],
    ["Não foi possível salvar as configurações remotas. A cópia local foi preservada.", "Could not save remote settings. The local copy was preserved.", "No se pudo guardar la configuración remota. Se conservó la copia local.", "Impossible d’enregistrer les paramètres distants. La copie locale est préservée.", "Entfernte Einstellungen konnten nicht gespeichert werden. Die lokale Kopie wurde erhalten.", "リモート設定を保存できませんでした。ローカルコピーは保持されています。"],
    ["Offline — aguardando confirmação do servidor. Os dados locais continuam disponíveis.", "Offline — waiting for server confirmation. Local data remains available.", "Sin conexión — esperando confirmación del servidor. Los datos locales siguen disponibles.", "Hors ligne — en attente de confirmation du serveur. Les données locales restent disponibles.", "Offline — Warten auf Serverbestätigung. Lokale Daten bleiben verfügbar.", "オフラインです。サーバーの確認を待っています。ローカルデータは引き続き利用できます。"],
    ["Há lançamentos remotos inválidos ou duplicados. Os dados locais foram mantidos; nenhum envio foi feito.", "Invalid or duplicate remote transactions found. Local data was kept; nothing was uploaded.", "Hay movimientos remotos no válidos o duplicados. Se conservaron los datos locales y no se envió nada.", "Des opérations distantes invalides ou en double ont été détectées. Les données locales sont conservées ; aucun envoi n’a été effectué.", "Ungültige oder doppelte entfernte Buchungen gefunden. Lokale Daten wurden erhalten; nichts wurde hochgeladen.", "無効または重複したリモート取引があります。ローカルデータを保持し、送信しませんでした。"],
    ["Há documentos remotos com chaves legadas. A leitura foi preservada; o envio exige revisão.", "Remote documents use legacy keys. The read data was preserved; review is required before uploading.", "Hay documentos remotos con claves antiguas. Se conservó la lectura; el envío requiere revisión.", "Des documents distants utilisent d’anciennes clés. Les données lues sont conservées ; un examen est requis avant l’envoi.", "Entfernte Dokumente verwenden alte Schlüssel. Gelesene Daten wurden erhalten; vor dem Upload ist eine Prüfung erforderlich.", "リモート文書に古いキーがあります。読み取ったデータは保持されています。送信前に確認が必要です。"],
    ["Vinculo ja revisado em outra aba. Tente novamente para continuar.", "Linking was already reviewed in another tab. Try again to continue.", "El vínculo ya se revisó en otra pestaña. Vuelve a intentarlo para continuar.", "La liaison a déjà été vérifiée dans un autre onglet. Réessayez pour continuer.", "Die Verknüpfung wurde bereits in einem anderen Tab geprüft. Versuche es erneut, um fortzufahren.", "別のタブで連携が確認されています。続行するには再試行してください。"],
    ["As categorias ou os orcamentos diferem. OK mantem os deste dispositivo; Cancelar usa os da nuvem. As duas copias serao preservadas no registro de conflito.", "Categories or budgets differ. OK keeps this device’s settings; Cancel uses the cloud settings. Both copies will be preserved in the conflict record.", "Las categorías o los presupuestos difieren. Aceptar conserva los de este dispositivo; Cancelar usa los de la nube. Ambas copias se conservarán en el conflicto.", "Les catégories ou budgets diffèrent. OK conserve ceux de cet appareil ; Annuler utilise ceux du cloud. Les deux copies seront conservées dans le conflit.", "Kategorien oder Budgets unterscheiden sich. OK behält die Einstellungen dieses Geräts; Abbrechen verwendet die Cloud-Einstellungen. Beide Kopien werden im Konflikt gespeichert.", "カテゴリまたは予算が異なります。OKでこの端末の設定を保持し、キャンセルでクラウドの設定を使います。両方のコピーを競合記録に保持します。"],
    ["Entra neste mês e nos {0} seguintes.", "Included this month and the next {0} months.", "Se incluye este mes y los {0} siguientes.", "Inclus ce mois-ci et les {0} mois suivants.", "In diesem und den nächsten {0} Monaten enthalten.", "今月と翌月以降{0}か月に追加します。"],
    ["Aplicar nome, categoria e valor também à próxima", "Also apply name, category and amount to the next item", "Aplicar también nombre, categoría e importe al siguiente", "Appliquer aussi le nom, la catégorie et le montant à la suivante", "Name, Kategorie und Betrag auch auf den nächsten Eintrag anwenden", "次の項目にも名前、カテゴリ、金額を適用"],
    ["Aplicar nome, categoria e valor também às {0} próximas", "Also apply name, category and amount to the next {0} items", "Aplicar también nombre, categoría e importe a los {0} siguientes", "Appliquer aussi le nom, la catégorie et le montant aux {0} suivantes", "Name, Kategorie und Betrag auch auf die nächsten {0} Einträge anwenden", "次の{0}件にも名前、カテゴリ、金額を適用"],
    ["Despesa atualizada.", "Expense updated.", "Gasto actualizado.", "Dépense modifiée.", "Ausgabe aktualisiert.", "支出を更新しました。"],
    ["Despesa atualizada, inclusive nas {0} seguintes.", "Expense updated, including the next {0} items.", "Gasto actualizado, incluidos los {0} siguientes.", "Dépense modifiée, y compris les {0} suivantes.", "Ausgabe einschließlich der nächsten {0} Einträge aktualisiert.", "次の{0}件を含めて支出を更新しました。"],
    ["Informe de 2 a {0} parcelas.", "Enter between 2 and {0} installments.", "Introduce entre 2 y {0} cuotas.", "Saisissez entre 2 et {0} échéances.", "Gib zwischen 2 und {0} Raten ein.", "分割回数は2～{0}回で入力してください。"],
    ["Despesa fixa lançada em {0} meses.", "Fixed expense added for {0} months.", "Gasto fijo añadido para {0} meses.", "Dépense fixe ajoutée pour {0} mois.", "Feste Ausgabe für {0} Monate hinzugefügt.", "固定支出を{0}か月分追加しました。"],
    ["Parcelas lançadas: {0} de {1}.", "Installments added: {0} of {1}.", "Cuotas añadidas: {0} de {1}.", "Échéances ajoutées : {0} sur {1}.", "Raten hinzugefügt: {0} von {1}.", "分割払いを追加しました：{1}回中{0}回。"],
    ["{0} é a parcela {1}/{2}. Há mais {3} parcela nos meses seguintes.", "{0} is installment {1}/{2}. There is {3} more installment in the following months.", "{0} es la cuota {1}/{2}. Hay {3} cuota más en los meses siguientes.", "{0} est l’échéance {1}/{2}. Il reste {3} échéance les mois suivants.", "{0} ist Rate {1}/{2}. Es gibt {3} weitere Rate in den Folgemonaten.", "{0}は{2}回中{1}回目です。翌月以降に残り{3}回あります。"],
    ["{0} é a parcela {1}/{2}. Há mais {3} parcelas nos meses seguintes.", "{0} is installment {1}/{2}. There are {3} more installments in the following months.", "{0} es la cuota {1}/{2}. Hay {3} cuotas más en los meses siguientes.", "{0} est l’échéance {1}/{2}. Il reste {3} échéances les mois suivants.", "{0} ist Rate {1}/{2}. Es gibt {3} weitere Raten in den Folgemonaten.", "{0}は{2}回中{1}回目です。翌月以降に残り{3}回あります。"],
    ["{0} é uma despesa fixa e também está lançada em {1} mês seguinte.", "{0} is a fixed expense also included in the next {1} month.", "{0} es un gasto fijo incluido también en el {1} mes siguiente.", "{0} est une dépense fixe également incluse dans le {1} mois suivant.", "{0} ist eine feste Ausgabe und auch im nächsten {1} Monat enthalten.", "{0}は固定支出で、翌月以降{1}か月にも登録されています。"],
    ["{0} é uma despesa fixa e também está lançada em {1} meses seguintes.", "{0} is a fixed expense also included in the next {1} months.", "{0} es un gasto fijo incluido también en los {1} meses siguientes.", "{0} est une dépense fixe également incluse dans les {1} mois suivants.", "{0} ist eine feste Ausgabe und auch in den nächsten {1} Monaten enthalten.", "{0}は固定支出で、翌月以降{1}か月にも登録されています。"],
    ["Remover entrada", "Remove income", "Eliminar ingreso", "Supprimer le revenu", "Einnahme entfernen", "収入を削除"],
    ["Só esta entrada", "This income only", "Solo este ingreso", "Ce revenu uniquement", "Nur diese Einnahme", "この収入のみ"],
    ["Esta e as futuras", "This and future occurrences", "Esta y las futuras", "Cette occurrence et les suivantes", "Diese und zukünftige Vorkommen", "今回と今後の分"],
    ["\"{0}\" tem {1} ocorrência futura. Deseja excluir também as ocorrências futuras?", "\"{0}\" has {1} future occurrence. Delete future occurrences too?", "\"{0}\" tiene {1} aparición futura. ¿Eliminar también las futuras?", "\"{0}\" a {1} occurrence future. Supprimer aussi les occurrences futures ?", "\"{0}\" hat {1} zukünftiges Vorkommen. Auch zukünftige Vorkommen löschen?", "「{0}」には今後{1}件あります。今後の分も削除しますか？"],
    ["\"{0}\" tem {1} ocorrências futuras. Deseja excluir também as ocorrências futuras?", "\"{0}\" has {1} future occurrences. Delete future occurrences too?", "\"{0}\" tiene {1} apariciones futuras. ¿Eliminar también las futuras?", "\"{0}\" a {1} occurrences futures. Supprimer aussi les occurrences futures ?", "\"{0}\" hat {1} zukünftige Vorkommen. Auch zukünftige Vorkommen löschen?", "「{0}」には今後{1}件あります。今後の分も削除しますか？"],
    ["Já existe uma categoria com esse nome.", "A category with this name already exists.", "Ya existe una categoría con ese nombre.", "Une catégorie porte déjà ce nom.", "Eine Kategorie mit diesem Namen ist bereits vorhanden.", "同じ名前のカテゴリが既にあります。"],
    ["Mantenha pelo menos uma categoria.", "Keep at least one category.", "Mantén al menos una categoría.", "Conservez au moins une catégorie.", "Behalte mindestens eine Kategorie.", "少なくとも1つのカテゴリを残してください。"],
    ["Remover a categoria {0}?", "Remove category {0}?", "¿Eliminar la categoría {0}?", "Supprimer la catégorie {0} ?", "Kategorie {0} entfernen?", "カテゴリ「{0}」を削除しますか？"],
    ["Remover {0}? As {1} despesa(s) dessa categoria passarão para {2}.", "Remove {0}? The {1} expense(s) in this category will move to {2}.", "¿Eliminar {0}? Los {1} gastos de esta categoría pasarán a {2}.", "Supprimer {0} ? Les {1} dépenses de cette catégorie seront transférées vers {2}.", "{0} entfernen? Die {1} Ausgaben dieser Kategorie werden nach {2} verschoben.", "「{0}」を削除しますか？このカテゴリの支出{1}件を「{2}」に移します。"],
    ["O mês anterior ({0}) não tem dados para copiar.", "The previous month ({0}) has no data to copy.", "El mes anterior ({0}) no tiene datos para copiar.", "Le mois précédent ({0}) ne contient aucune donnée à copier.", "Der vorherige Monat ({0}) enthält keine Daten zum Kopieren.", "前月（{0}）にはコピーするデータがありません。"],
    ["Este mês já tem lançamentos. Adicionar os de {0} junto com eles?", "This month already has transactions. Add those from {0} as well?", "Este mes ya tiene movimientos. ¿Añadir también los de {0}?", "Ce mois contient déjà des opérations. Ajouter celles de {0} ?", "Dieser Monat enthält bereits Buchungen. Auch die aus {0} hinzufügen?", "この月には既に取引があります。{0}の取引も追加しますか？"],
    ["Lançamentos copiados de {0}.", "Transactions copied from {0}.", "Movimientos copiados de {0}.", "Opérations copiées depuis {0}.", "Buchungen aus {0} kopiert.", "{0}の取引をコピーしました。"],
    ["Apagar todas as entradas e despesas de {0} de {1}? Essa ação não pode ser desfeita.", "Delete all income and expenses for {0} {1}? This cannot be undone.", "¿Eliminar todos los ingresos y gastos de {0} de {1}? Esta acción no se puede deshacer.", "Supprimer tous les revenus et dépenses de {0} {1} ? Cette action est irréversible.", "Alle Einnahmen und Ausgaben für {0} {1} löschen? Dies kann nicht rückgängig gemacht werden.", "{1}年{0}の収入と支出をすべて削除しますか？元に戻せません。"],
    ["Excluir todas as entradas e despesas de todos os meses? Essa ação não pode ser desfeita.", "Delete all income and expenses for all months? This cannot be undone.", "¿Eliminar todos los ingresos y gastos de todos los meses? Esta acción no se puede deshacer.", "Supprimer tous les revenus et dépenses de tous les mois ? Cette action est irréversible.", "Alle Einnahmen und Ausgaben aller Monate löschen? Dies kann nicht rückgängig gemacht werden.", "すべての月の収入と支出を削除しますか？元に戻せません。"],
    ["Não há lançamentos para excluir.", "There are no transactions to delete.", "No hay movimientos para eliminar.", "Aucune opération à supprimer.", "Es gibt keine Buchungen zum Löschen.", "削除する取引はありません。"],
    ["Todos os lançamentos foram excluídos.", "All transactions deleted.", "Se eliminaron todos los movimientos.", "Toutes les opérations ont été supprimées.", "Alle Buchungen wurden gelöscht.", "すべての取引を削除しました。"],
    ["Controle Financeiro", "Financial Manager", "Control financiero", "Gestion financière", "Finanzverwaltung", "家計管理"],
    ["Pendente no mês", "Pending this month", "Pendiente del mes", "En attente ce mois-ci", "Diesen Monat ausstehend", "今月の未払い"],
    ["Taxa de economia", "Savings rate", "Tasa de ahorro", "Taux d’épargne", "Sparquote", "貯蓄率"],
    ["Variação das despesas", "Expense change", "Variación de gastos", "Variation des dépenses", "Ausgabenänderung", "支出の増減"],
    ["Comparação com", "Compared with", "Comparación con", "Comparaison avec", "Vergleich mit", "比較対象"],
    ["Não calculável: sem entradas", "Not calculable: no income", "No calculable: sin ingresos", "Non calculable : aucun revenu", "Nicht berechenbar: keine Einnahmen", "計算不可：収入なし"],
    ["Não calculável: mês anterior sem despesas", "Not calculable: no expenses last month", "No calculable: mes anterior sin gastos", "Non calculable : aucune dépense le mois précédent", "Nicht berechenbar: keine Ausgaben im Vormonat", "計算不可：先月の支出なし"],
    ["Saldo total", "Total balance", "Saldo total", "Solde total", "Gesamtsaldo", "合計残高"],
    ["Falta pagar", "Still due", "Pendiente de pago", "Reste à payer", "Noch zu zahlen", "未払い額"],
    ["Total", "Total", "Total", "Total", "Gesamt", "合計"],
    ["Pago", "Paid", "Pagado", "Payé", "Bezahlt", "支払い済み"],
    ["Sem nome", "Unnamed", "Sin nombre", "Sans nom", "Unbenannt", "名称未設定"],
    ["sem nome", "unnamed", "sin nombre", "sans nom", "unbenannt", "名称未設定"],
    ["Sem limite", "No limit", "Sin límite", "Sans limite", "Kein Limit", "上限なし"],
    ["Limpar mês atual", "Clear current month", "Borrar mes actual", "Effacer le mois actuel", "Aktuellen Monat leeren", "今月をクリア"],
    ["Excluir tudo", "Delete all", "Eliminar todo", "Tout supprimer", "Alles löschen", "すべて削除"],
    ["Não verificada", "Not checked", "No verificada", "Non vérifiée", "Nicht geprüft", "未確認"],
    ["Fechar calculadora", "Close calculator", "Cerrar calculadora", "Fermer la calculatrice", "Taschenrechner schließen", "電卓を閉じる"],
    ["Limpar tudo", "Clear all", "Borrar todo", "Tout effacer", "Alles zurücksetzen", "すべてクリア"],
    ["Apagar último caractere", "Delete last character", "Borrar último carácter", "Effacer le dernier caractère", "Letztes Zeichen löschen", "最後の文字を削除"],
    ["Abrir parêntese", "Open parenthesis", "Abrir paréntesis", "Ouvrir une parenthèse", "Klammer öffnen", "開き括弧"],
    ["Fechar parêntese", "Close parenthesis", "Cerrar paréntesis", "Fermer une parenthèse", "Klammer schließen", "閉じ括弧"],
    ["Ex.: Aluguel", "E.g. Rent", "Ej.: Alquiler", "Ex. : Loyer", "Z. B. Miete", "例：家賃"],
    ["Ex.: Salário", "E.g. Salary", "Ej.: Salario", "Ex. : Salaire", "Z. B. Gehalt", "例：給与"],
    ["Claro, Escuro, Rosa, Pangolin ou Selva", "Light, Dark, Pink, Pangolin or Jungle", "Claro, Oscuro, Rosa, Pangolín o Selva", "Clair, Sombre, Rose, Pangolin ou Jungle", "Hell, Dunkel, Rosa, Pangolin oder Dschungel", "ライト、ダーク、ピンク、センザンコウ、ジャングル"],
    ["Nenhuma receita neste mês. Adicione salário, renda extra ou outros valores recebidos.", "No income this month. Add salary, extra income or other amounts received.", "No hay ingresos este mes. Añade salario, ingresos extra u otros importes recibidos.", "Aucun revenu ce mois-ci. Ajoutez un salaire, des revenus supplémentaires ou d’autres sommes reçues.", "Keine Einnahmen in diesem Monat. Füge Gehalt, Zusatzeinkünfte oder andere Einnahmen hinzu.", "今月の収入はありません。給与、副収入、その他の受取額を追加してください。"],
    ["Os dados locais continuam disponíveis offline. Ao vincular uma conta pela primeira vez, o app mostra uma prévia e pede confirmação. Backups não incluem dados de autenticação.", "Local data remains available offline. When linking an account for the first time, the app shows a preview and asks for confirmation. Backups do not include authentication data.", "Los datos locales siguen disponibles sin conexión. Al vincular una cuenta por primera vez, la aplicación muestra una vista previa y pide confirmación. Las copias no incluyen datos de autenticación.", "Les données locales restent disponibles hors ligne. Lors de la première liaison d’un compte, l’application affiche un aperçu et demande confirmation. Les sauvegardes n’incluent pas les données d’authentification.", "Lokale Daten bleiben offline verfügbar. Beim ersten Verknüpfen eines Kontos zeigt die App eine Vorschau und bittet um Bestätigung. Sicherungen enthalten keine Anmeldedaten.", "ローカルデータはオフラインでも利用できます。初めてアカウントを連携するときは、プレビューを表示して確認を求めます。バックアップに認証データは含まれません。"],
    ["Ocultar valores financeiros do resumo", "Hide financial amounts in summary", "Ocultar importes financieros del resumen", "Masquer les montants financiers du résumé", "Finanzbeträge in der Übersicht ausblenden", "サマリーの金額を非表示"],
    ["Mostrar valores do resumo", "Show summary amounts", "Mostrar importes del resumen", "Afficher les montants du résumé", "Beträge in der Übersicht anzeigen", "サマリーの金額を表示"],
    ["Ocultar valores do resumo", "Hide summary amounts", "Ocultar importes del resumen", "Masquer les montants du résumé", "Beträge in der Übersicht ausblenden", "サマリーの金額を非表示"],
    ["Adicione suas entradas para ver quanto da renda está comprometido.", "Add your income to see how much is committed.", "Añade tus ingresos para ver cuánto está comprometido.", "Ajoutez vos revenus pour voir la part engagée.", "Füge Einnahmen hinzu, um den gebundenen Anteil zu sehen.", "収入を追加すると、使用済みの割合が表示されます。"],
    ["Você gastou {0} da renda: as despesas passaram das entradas.", "You spent {0} of your income: expenses exceeded income.", "Has gastado el {0} de tus ingresos: los gastos superaron los ingresos.", "Vous avez dépensé {0} de vos revenus : les dépenses dépassent les revenus.", "Du hast {0} deiner Einnahmen ausgegeben: Die Ausgaben übersteigen die Einnahmen.", "収入の{0}を使いました。支出が収入を超えています。"],
    ["{0} da renda comprometida", "{0} of income committed", "{0} de los ingresos comprometidos", "{0} des revenus engagés", "{0} der Einnahmen gebunden", "収入の{0}を使用済み"],
    ["Total da categoria: {0}", "Category total: {0}", "Total de la categoría: {0}", "Total de la catégorie : {0}", "Kategoriesumme: {0}", "カテゴリ合計：{0}"],
    ["Limite: {0}", "Limit: {0}", "Límite: {0}", "Limite : {0}", "Limit: {0}", "上限：{0}"],
    ["Gasto: {0}", "Spent: {0}", "Gastado: {0}", "Dépensé : {0}", "Ausgegeben: {0}", "支出：{0}"],
    ["Restante: {0}", "Remaining: {0}", "Restante: {0}", "Restant : {0}", "Übrig: {0}", "残り：{0}"],
    ["Excesso: {0}", "Over: {0}", "Exceso: {0}", "Dépassement : {0}", "Überschritten: {0}", "超過：{0}"],
    ["{0} consumido", "{0} used", "{0} consumido", "{0} utilisé", "{0} verbraucht", "{0}使用済み"],
    ["Limite mensal padrão para {0}", "Default monthly limit for {0}", "Límite mensual predeterminado de {0}", "Limite mensuelle par défaut pour {0}", "Monatliches Standardlimit für {0}", "{0}の月間標準上限"],
    ["{0}, orçamento excedido", "{0}, budget exceeded", "{0}, presupuesto superado", "{0}, budget dépassé", "{0}, Budget überschritten", "{0}、予算超過"],
    ["Editar entrada {0}", "Edit income {0}", "Editar ingreso {0}", "Modifier le revenu {0}", "Einnahme {0} bearbeiten", "収入「{0}」を編集"],
    ["Remover entrada {0}", "Remove income {0}", "Eliminar ingreso {0}", "Supprimer le revenu {0}", "Einnahme {0} entfernen", "収入「{0}」を削除"],
    ["Editar despesa {0}", "Edit expense {0}", "Editar gasto {0}", "Modifier la dépense {0}", "Ausgabe {0} bearbeiten", "支出「{0}」を編集"],
    ["Remover despesa {0}", "Remove expense {0}", "Eliminar gasto {0}", "Supprimer la dépense {0}", "Ausgabe {0} entfernen", "支出「{0}」を削除"],
    ["Tema atual: {0}. Mudar para {1}.", "Current theme: {0}. Switch to {1}.", "Tema actual: {0}. Cambiar a {1}.", "Thème actuel : {0}. Passer à {1}.", "Aktuelles Design: {0}. Wechseln zu {1}.", "現在のテーマ：{0}。{1}に切り替え。"],
    ["{0}, entradas {1}, despesas {2}", "{0}, income {1}, expenses {2}", "{0}, ingresos {1}, gastos {2}", "{0}, revenus {1}, dépenses {2}", "{0}, Einnahmen {1}, Ausgaben {2}", "{0}、収入{1}、支出{2}"],
    ["Despesas por categoria em {0}. Total {1}. {2}", "Expenses by category in {0}. Total {1}. {2}", "Gastos por categoría en {0}. Total {1}. {2}", "Dépenses par catégorie en {0}. Total {1}. {2}", "Ausgaben nach Kategorie im {0}. Gesamt {1}. {2}", "{0}のカテゴリ別支出。合計{1}。{2}"],
    ["Nenhuma despesa com valor registrado em {0}.", "No expenses with an amount recorded in {0}.", "No hay gastos con importe registrado en {0}.", "Aucune dépense avec un montant enregistré en {0}.", "Keine Ausgaben mit erfasstem Betrag im {0}.", "{0}には金額が記録された支出はありません。"],
    ["Sincronização entre dispositivos", "Sync across devices", "Sincronización entre dispositivos", "Synchronisation entre appareils", "Synchronisierung zwischen Geräten", "デバイス間同期"],
    ["Somente neste dispositivo.", "This device only.", "Solo en este dispositivo.", "Cet appareil uniquement.", "Nur auf diesem Gerät.", "この端末のみ。"],
    ["Entrar com Google", "Sign in with Google", "Iniciar sesión con Google", "Se connecter avec Google", "Mit Google anmelden", "Google でログイン"],
    ["Sair da conta", "Sign out", "Cerrar sesión", "Se déconnecter", "Abmelden", "ログアウト"],
    ["Ativar sincronização desta conta", "Enable sync for this account", "Activar sincronización de esta cuenta", "Activer la synchronisation de ce compte", "Synchronisierung für dieses Konto aktivieren", "このアカウントの同期を有効にする"],
    ["Tentar novamente", "Try again", "Intentar de nuevo", "Réessayer", "Erneut versuchen", "再試行"],
    ["Revisar e sincronizar backup restaurado", "Review and sync restored backup", "Revisar y sincronizar la copia restaurada", "Vérifier et synchroniser la sauvegarde restaurée", "Wiederhergestellte Sicherung prüfen und synchronisieren", "復元したバックアップを確認して同期"],
    ["Revisar conflitos", "Review conflicts", "Revisar conflictos", "Examiner les conflits", "Konflikte prüfen", "競合を確認"],
    ["Conflitos de sincronização", "Sync conflicts", "Conflictos de sincronización", "Conflits de synchronisation", "Synchronisierungskonflikte", "同期の競合"],
    ["Manter versão local", "Keep local version", "Mantener versión local", "Garder la version locale", "Lokale Version behalten", "ローカル版を保持"],
    ["Usar versão da nuvem", "Use cloud version", "Usar versión de la nube", "Utiliser la version cloud", "Cloud-Version verwenden", "クラウド版を使用"],
    ["Manter as duas versões", "Keep both versions", "Mantener ambas versiones", "Garder les deux versions", "Beide Versionen behalten", "両方のバージョンを保持"],
    ["Manter configurações locais", "Keep local settings", "Mantener la configuración local", "Garder les paramètres locaux", "Lokale Einstellungen behalten", "ローカル設定を保持"],
    ["Usar configurações da nuvem", "Use cloud settings", "Usar configuración de la nube", "Utiliser les paramètres cloud", "Cloud-Einstellungen verwenden", "クラウド設定を使用"],
    ["Sincronizado", "Synced", "Sincronizado", "Synchronisé", "Synchronisiert", "同期済み"],
    ["Sincronizando…", "Syncing…", "Sincronizando…", "Synchronisation…", "Synchronisierung…", "同期中…"],
    ["Aguardando envio.", "Waiting to upload.", "Esperando para enviar.", "En attente d’envoi.", "Warten auf Upload.", "送信待ち。"],
    ["Conectando ao Firebase…", "Connecting to Firebase…", "Conectando con Firebase…", "Connexion à Firebase…", "Verbindung mit Firebase…", "Firebase に接続中…"],
    ["Carregando dados desta conta…", "Loading this account’s data…", "Cargando los datos de esta cuenta…", "Chargement des données de ce compte…", "Kontodaten werden geladen…", "このアカウントのデータを読み込み中…"],
    ["Firebase indisponível. Os dados locais continuam funcionando.", "Firebase is unavailable. Local data remains available.", "Firebase no está disponible. Los datos locales siguen disponibles.", "Firebase est indisponible. Les données locales restent disponibles.", "Firebase ist nicht verfügbar. Lokale Daten bleiben verfügbar.", "Firebase は利用できません。ローカルデータは引き続き使用できます。"],
    ["Falha ao carregar a conta. Os dados locais foram mantidos.", "Could not load the account. Local data was preserved.", "No se pudo cargar la cuenta. Se conservaron los datos locales.", "Impossible de charger le compte. Les données locales ont été conservées.", "Konto konnte nicht geladen werden. Lokale Daten wurden beibehalten.", "アカウントを読み込めませんでした。ローカルデータは保持されています。"],
    ["Sincronização desativada. Os dados permanecem locais.", "Sync is off. Data remains local.", "La sincronización está desactivada. Los datos siguen en este dispositivo.", "La synchronisation est désactivée. Les données restent locales.", "Synchronisierung ist deaktiviert. Daten bleiben lokal.", "同期はオフです。データは端末に残ります。"],
    ["Aguardando primeira confirmação.", "Waiting for the first confirmation.", "Esperando la primera confirmación.", "En attente de la première confirmation.", "Warten auf die erste Bestätigung.", "最初の確認を待っています。"],
    ["Sincronizado com conflitos para revisar.", "Synced with conflicts to review.", "Sincronizado con conflictos por revisar.", "Synchronisé avec des conflits à examiner.", "Synchronisiert; Konflikte müssen geprüft werden.", "同期済みです。確認が必要な競合があります。"],
    ["Falha no envio. As alterações continuam salvas localmente.", "Upload failed. Changes are still saved locally.", "Falló el envío. Los cambios siguen guardados localmente.", "Échec de l’envoi. Les modifications restent enregistrées localement.", "Upload fehlgeschlagen. Änderungen bleiben lokal gespeichert.", "送信に失敗しました。変更はローカルに保存されています。"],
    ["Não foi possível persistir os dados locais desta conta. A sincronização foi pausada.", "Could not persist this account’s local data. Sync was paused.", "No se pudieron guardar localmente los datos de esta cuenta. Se pausó la sincronización.", "Impossible d’enregistrer localement les données de ce compte. La synchronisation est suspendue.", "Kontodaten konnten nicht lokal gespeichert werden. Synchronisierung wurde pausiert.", "このアカウントのデータを端末に保存できません。同期を一時停止しました。"],
    ["Migração suspensa: recupere os dados locais protegidos antes de continuar.", "Migration paused: recover protected local data before continuing.", "Migración pausada: recupere los datos locales protegidos antes de continuar.", "Migration suspendue : récupérez les données locales protégées avant de continuer.", "Migration angehalten: Stellen Sie geschützte lokale Daten wieder her.", "移行を一時停止しました。保護されたローカルデータを復元してください。"],
    ["Vínculo aguardando sua confirmação.", "Linking is waiting for your confirmation.", "El vínculo espera su confirmación.", "Le lien attend votre confirmation.", "Verknüpfung wartet auf Ihre Bestätigung.", "連携は確認待ちです。"],
    ["Erro ao observar alterações remotas.", "Error listening for remote changes.", "Error al escuchar cambios remotos.", "Erreur lors de l’écoute des modifications distantes.", "Fehler beim Beobachten entfernter Änderungen.", "リモート変更の監視中にエラーが発生しました。"],
    ["Há lançamentos remotos inválidos. Os dados locais foram mantidos; nenhum envio foi feito.", "Invalid remote records found. Local data was preserved; nothing was uploaded.", "Hay registros remotos no válidos. Se conservaron los datos locales y no se envió nada.", "Des écritures distantes invalides ont été détectées. Les données locales sont conservées et aucun envoi n’a été effectué.", "Ungültige Remotedatensätze gefunden. Lokale Daten bleiben erhalten; nichts wurde hochgeladen.", "無効なリモート記録があります。ローカルデータを保持し、送信しませんでした。"],
    ["Falha no envio. Tente novamente.", "Upload failed. Try again.", "Falló el envío. Inténtelo de nuevo.", "Échec de l’envoi. Réessayez.", "Upload fehlgeschlagen. Bitte erneut versuchen.", "送信に失敗しました。もう一度お試しください。"],
    ["Não foi possível sincronizar o backup; a cópia local continua preservada.", "Could not sync the backup; the local copy remains preserved.", "No se pudo sincronizar la copia; la copia local sigue conservada.", "Impossible de synchroniser la sauvegarde ; la copie locale est conservée.", "Sicherung konnte nicht synchronisiert werden; die lokale Kopie bleibt erhalten.", "バックアップを同期できませんでした。ローカルコピーは保持されています。"],
    ["A escolha foi salva localmente e aguarda envio.", "Your choice was saved locally and is waiting to upload.", "La selección se guardó localmente y espera el envío.", "Votre choix a été enregistré localement et attend l’envoi.", "Die Auswahl wurde lokal gespeichert und wartet auf den Upload.", "選択をローカルに保存しました。送信待ちです。"],
    ["Offline — alterações pendentes.", "Offline — changes pending.", "Sin conexión — hay cambios pendientes.", "Hors ligne — modifications en attente.", "Offline — Änderungen ausstehend.", "オフライン — 変更が保留中です。"],
    ["Offline — as alterações serão enviadas quando houver conexão.", "Offline — changes will upload when a connection is available.", "Sin conexión — los cambios se enviarán cuando vuelva la conexión.", "Hors ligne — les modifications seront envoyées dès le retour de la connexion.", "Offline — Änderungen werden bei Verbindung hochgeladen.", "オフライン — 接続時に変更を送信します。"],
    ["Conflito de configurações preservado para revisão.", "Settings conflict preserved for review.", "Conflicto de configuración conservado para revisión.", "Conflit de paramètres conservé pour examen.", "Einstellungskonflikt zur Überprüfung gespeichert.", "設定の競合を保存しました。確認してください。"],
    ["Configurações alteradas em outro dispositivo; as duas versões foram preservadas.", "Settings changed on another device; both versions were preserved.", "La configuración cambió en otro dispositivo; se conservaron ambas versiones.", "Les paramètres ont changé sur un autre appareil ; les deux versions ont été conservées.", "Einstellungen wurden auf einem anderen Gerät geändert; beide Versionen wurden gespeichert.", "別の端末で設定が変更されました。両方のバージョンを保持しました。"],
    ["Ainda não há sincronização confirmada.", "No sync has been confirmed yet.", "Todavía no hay una sincronización confirmada.", "Aucune synchronisation n’a encore été confirmée.", "Noch keine Synchronisierung bestätigt.", "同期はまだ確認されていません。"],
    ["Última sincronização confirmada:", "Last confirmed sync:", "Última sincronización confirmada:", "Dernière synchronisation confirmée :", "Letzte bestätigte Synchronisierung:", "最後に確認された同期:"],
    ["Backup restaurado localmente. Revise antes de sincronizar com a nuvem.", "Backup restored locally. Review before syncing to the cloud.", "Copia restaurada localmente. Revísela antes de sincronizar con la nube.", "Sauvegarde restaurée localement. Vérifiez-la avant la synchronisation cloud.", "Sicherung lokal wiederhergestellt. Vor der Cloud-Synchronisierung prüfen.", "バックアップを端末に復元しました。クラウド同期前に確認してください。"],
    ["Configure o projeto Firebase neste dispositivo para habilitar o login.", "Configure Firebase on this device to enable sign-in.", "Configura Firebase en este dispositivo para habilitar el inicio de sesión.", "Configurez Firebase sur cet appareil pour activer la connexion.", "Konfigurieren Sie Firebase auf diesem Gerät, um die Anmeldung zu aktivieren.", "ログインを有効にするには、この端末で Firebase を設定してください。"],
    ["Repetir mensalmente por 12 meses", "Repeat monthly for 12 months", "Repetir mensualmente durante 12 meses", "Répéter chaque mois pendant 12 mois", "12 Monate lang monatlich wiederholen", "12か月間、毎月繰り返す"],
    ["Mensal", "Monthly", "Mensual", "Mensuel", "Monatlich", "毎月"],
    ["Série mensal", "Monthly series", "Serie mensual", "Série mensuelle", "Monatliche Serie", "月次シリーズ"],
    ["Série mensal:", "Monthly series:", "Serie mensual:", "Série mensuelle :", "Monatliche Serie:", "月次シリーズ:"],
    ["Cancelar próximas ocorrências", "Cancel upcoming occurrences", "Cancelar próximas ocurrencias", "Annuler les prochaines occurrences", "Künftige Vorkommen abbrechen", "今後の発生をキャンセル"],
    ["Cancelar próximas ocorrências de", "Cancel upcoming occurrences of", "Cancelar próximas ocurrencias de", "Annuler les prochaines occurrences de", "Künftige Vorkommen von", "今後の発生をキャンセル:"],
    ["Ocorrências futuras canceladas:", "Future occurrences canceled:", "Se cancelaron las ocurrencias futuras:", "Occurrences futures annulées :", "Künftige Vorkommen abgebrochen:", "今後の発生をキャンセルしました:"],
    ["Esta série mensal já foi criada.", "This monthly series has already been created.", "Esta serie mensual ya se creó.", "Cette série mensuelle a déjà été créée.", "Diese monatliche Serie wurde bereits erstellt.", "この月次シリーズはすでに作成されています。"],
    ["Período", "Period", "Período", "Période", "Zeitraum", "期間"],
    ["Mês", "Month", "Mes", "Mois", "Monat", "月"],
    ["Ano", "Year", "Año", "Année", "Jahr", "年"],
    ["Hoje", "Today", "Hoy", "Aujourd’hui", "Heute", "今日"],
    ["Mês anterior", "Previous month", "Mes anterior", "Mois précédent", "Vorheriger Monat", "前月"],
    ["Próximo mês", "Next month", "Mes siguiente", "Mois suivant", "Nächster Monat", "翌月"],
    ["Abrir calculadora", "Open calculator", "Abrir calculadora", "Ouvrir la calculatrice", "Taschenrechner öffnen", "電卓を開く"],
    ["Abrir opções", "Open options", "Abrir opciones", "Ouvrir les options", "Optionen öffnen", "オプションを開く"],
    ["Fechar", "Close", "Cerrar", "Fermer", "Schließen", "閉じる"],
    ["Expandir", "Expand", "Expandir", "Développer", "Erweitern", "展開"],
    ["Recolher", "Collapse", "Contraer", "Réduire", "Einklappen", "折りたたむ"],
    ["Expandir despesas", "Expand expenses", "Expandir gastos", "Développer les dépenses", "Ausgaben erweitern", "支出を展開"],
    ["Recolher despesas", "Collapse expenses", "Contraer gastos", "Réduire les dépenses", "Ausgaben einklappen", "支出を折りたたむ"],
    ["Expandir entradas", "Expand income", "Expandir ingresos", "Développer les revenus", "Einnahmen erweitern", "収入を展開"],
    ["Recolher entradas", "Collapse income", "Contraer ingresos", "Réduire les revenus", "Einnahmen einklappen", "収入を折りたたむ"],
    ["Expandir orçamento por categoria", "Expand budget by category", "Expandir presupuesto por categoría", "Développer le budget par catégorie", "Budget nach Kategorie erweitern", "カテゴリ別予算を展開"],
    ["Recolher orçamento por categoria", "Collapse budget by category", "Contraer presupuesto por categoría", "Réduire le budget par catégorie", "Budget nach Kategorie einklappen", "カテゴリ別予算を折りたたむ"],
    ["despesas", "expenses", "gastos", "dépenses", "Ausgaben", "支出"],
    ["entradas", "income", "ingresos", "revenus", "Einnahmen", "収入"],
    ["Adicione entradas e despesas para acompanhar o mês.", "Add income and expenses to track the month.", "Añade ingresos y gastos para seguir el mes.", "Ajoutez des revenus et des dépenses pour suivre le mois.", "Füge Einnahmen und Ausgaben hinzu, um den Monat zu verfolgen.", "月を管理するには収入と支出を追加してください。"],
    ["por categoria", "by category", "por categoría", "par catégorie", "nach Kategorie", "カテゴリ別"],
    ["Nenhuma despesa com valor registrado em", "No expenses with an amount recorded in", "No hay gastos con importe registrado en", "Aucune dépense avec un montant enregistré en", "Keine Ausgaben mit erfasstem Betrag in", "金額が記録された支出はありません:"],
    ["Janeiro", "January", "Enero", "Janvier", "Januar", "1月"],
    ["Fevereiro", "February", "Febrero", "Février", "Februar", "2月"],
    ["Março", "March", "Marzo", "Mars", "März", "3月"],
    ["Abril", "April", "Abril", "Avril", "April", "4月"],
    ["Maio", "May", "Mayo", "Mai", "Mai", "5月"],
    ["Junho", "June", "Junio", "Juin", "Juni", "6月"],
    ["Julho", "July", "Julio", "Juillet", "Juli", "7月"],
    ["Agosto", "August", "Agosto", "Août", "August", "8月"],
    ["Setembro", "September", "Septiembre", "Septembre", "September", "9月"],
    ["Outubro", "October", "Octubre", "Octobre", "Oktober", "10月"],
    ["Novembro", "November", "Noviembre", "Novembre", "November", "11月"],
    ["Dezembro", "December", "Diciembre", "Décembre", "Dezember", "12月"],
    ["RESUMO DO MÊS", "MONTHLY SUMMARY", "RESUMEN DEL MES", "RÉSUMÉ DU MOIS", "MONATSÜBERSICHT", "月間サマリー"],
    ["Saldo do mês", "Monthly balance", "Saldo del mes", "Solde du mois", "Monatssaldo", "今月の残高"],
    ["Informe suas receitas para ver quanto da renda está comprometido.", "Add your income to see how much of it is committed.", "Añade tus ingresos para ver cuánto está comprometido.", "Ajoutez vos revenus pour voir la part engagée.", "Gib Einnahmen ein, um den gebundenen Anteil zu sehen.", "収入を入力すると、使用済みの割合が表示されます。"],
    ["Entradas", "Income", "Ingresos", "Revenus", "Einnahmen", "収入"],
    ["Despesas", "Expenses", "Gastos", "Dépenses", "Ausgaben", "支出"],
    ["Já pago", "Paid", "Pagado", "Déjà payé", "Bereits bezahlt", "支払い済み"],
    ["A pagar", "Due", "Pendiente", "À payer", "Noch zu zahlen", "未払い"],
    ["PANORAMA", "OVERVIEW", "PANORAMA", "APERÇU", "ÜBERBLICK", "概要"],
    ["Visão geral", "Overview", "Vista general", "Vue d’ensemble", "Übersicht", "概要"],
    ["Gastos do mês", "Monthly spending", "Gastos del mes", "Dépenses du mois", "Monatsausgaben", "今月の支出"],
    ["Total no mês", "Monthly total", "Total del mes", "Total du mois", "Monatssumme", "月間合計"],
    ["Divisão das despesas por categoria neste mês", "Expense breakdown by category this month", "Desglose de gastos por categoría este mes", "Répartition des dépenses par catégorie ce mois-ci", "Ausgaben nach Kategorie in diesem Monat", "今月のカテゴリ別支出"],
    ["Categorias e valores das despesas", "Expense categories and amounts", "Categorías e importes de gastos", "Catégories et montants des dépenses", "Ausgabenkategorien und Beträge", "支出カテゴリと金額"],
    ["Adicione despesas neste mês para ver a divisão por categoria.", "Add expenses this month to see the category breakdown.", "Añade gastos este mes para ver el desglose por categoría.", "Ajoutez des dépenses ce mois-ci pour voir la répartition par catégorie.", "Füge diesen Monat Ausgaben hinzu, um die Aufteilung nach Kategorie zu sehen.", "今月の支出を追加すると、カテゴリ別の内訳が表示されます。"],
    ["Despesas do mês", "Monthly expenses", "Gastos del mes", "Dépenses du mois", "Monatsausgaben", "今月の支出"],
    ["Total da categoria:", "Category total:", "Total de la categoría:", "Total de la catégorie :", "Kategoriesumme:", "カテゴリ合計:"],
    ["Adicionar", "Add", "Añadir", "Ajouter", "Hinzufügen", "追加"],
    ["Total a pagar", "Total due", "Total pendiente", "Total à payer", "Gesamt noch offen", "未払い合計"],
    ["Opções", "Options", "Opciones", "Options", "Optionen", "オプション"],
    ["Fechar ajustes", "Close settings", "Cerrar ajustes", "Fermer les paramètres", "Einstellungen schließen", "設定を閉じる"],
    ["Aparência e visualização", "Appearance and display", "Apariencia y visualización", "Apparence et affichage", "Darstellung und Anzeige", "外観と表示"],
    ["Tema", "Theme", "Tema", "Thème", "Design", "テーマ"],
    ["Claro", "Light", "Claro", "Clair", "Hell", "ライト"],
    ["Escuro", "Dark", "Oscuro", "Sombre", "Dunkel", "ダーク"],
    ["Rosa", "Pink", "Rosa", "Rose", "Rosa", "ピンク"],
    ["Pangolim", "Pangolin", "Pangolín", "Pangolin", "Pangolin", "センザンコウ"],
    ["Selva", "Jungle", "Selva", "Jungle", "Dschungel", "ジャングル"],
    ["Tema atual:", "Current theme:", "Tema actual:", "Thème actuel :", "Aktuelles Design:", "現在のテーマ:"],
    ["Escuro, Claro, Rosa, Selva ou Pangolim", "Dark, Light, Pink, Jungle, or Pangolin", "Oscuro, Claro, Rosa, Selva o Pangolín", "Sombre, Clair, Rose, Jungle ou Pangolin", "Dunkel, Hell, Rosa, Dschungel oder Pangolin", "ダーク、ライト、ピンク、ジャングル、センザンコウ"],
    ["Alterar", "Change", "Cambiar", "Changer", "Ändern", "変更"],
    ["Densidade da interface", "Interface density", "Densidad de la interfaz", "Densité de l’interface", "Oberflächendichte", "画面密度"],
    ["Máxima compactação", "Maximum compactness", "Máxima compactación", "Compacité maximale", "Maximale Kompaktheit", "最大限のコンパクト"],
    ["Muito confortável", "Very comfortable", "Muy cómoda", "Très confortable", "Sehr komfortabel", "とてもゆったり"],
    ["Padrão", "Default", "Estándar", "Par défaut", "Standard", "標準"],
    ["Compacta", "Compact", "Compacta", "Compacte", "Kompakt", "コンパクト"],
    ["Confortável", "Comfortable", "Cómoda", "Confortable", "Komfortabel", "ゆったり"],
    ["Exibir gráficos na tela inicial", "Show charts on the home screen", "Mostrar gráficos en la pantalla de inicio", "Afficher les graphiques sur l’écran d’accueil", "Diagramme auf dem Startbildschirm anzeigen", "ホーム画面にグラフを表示"],
    ["Exibir resumo do mês na tela de início", "Show the monthly summary on the home screen", "Mostrar el resumen del mes en la pantalla de inicio", "Afficher le résumé du mois sur l’écran d’accueil", "Monatsübersicht auf dem Startbildschirm anzeigen", "ホーム画面に月次概要を表示"],
    ["Selecionar data no calendário", "Select a date from the calendar", "Seleccionar una fecha en el calendario", "Sélectionner une date dans le calendrier", "Kalenderdatum auswählen", "カレンダーから日付を選択"],
    ["Toque em Adicionar para começar", "Tap Add to get started", "Toca en Añadir para empezar", "Touchez Ajouter pour commencer", "Tippe auf Hinzufügen, um zu beginnen", "「追加」をタップして開始"],
    ["Botão de opções", "Options button", "Botón de opciones", "Bouton des options", "Optionen-Schaltfläche", "オプションボタン"],
    ["Posição", "Position", "Posición", "Position", "Position", "位置"],
    ["Centro", "Center", "Centro", "Centre", "Mitte", "中央"],
    ["Direita", "Right", "Derecha", "Droite", "Rechts", "右"],
    ["Esquerda", "Left", "Izquierda", "Gauche", "Links", "左"],
    ["Arrastável", "Draggable", "Arrastrable", "Déplaçable", "Verschiebbar", "ドラッグ可能"],
    ["Transparência", "Transparency", "Transparencia", "Transparence", "Transparenz", "透明度"],
    ["Tamanho do botão", "Button size", "Tamaño del botón", "Taille du bouton", "Schaltflächengröße", "ボタンサイズ"],
    ["Preferências financeiras", "Financial preferences", "Preferencias financieras", "Préférences financières", "Finanzeinstellungen", "金融設定"],
    ["Tela inicial", "Home screen", "Pantalla de inicio", "Écran d’accueil", "Startbildschirm", "ホーム画面"],
    ["Resumo do mês", "Monthly summary", "Resumen del mes", "Résumé du mois", "Monatsübersicht", "月間サマリー"],
    ["Lançamentos", "Transactions", "Movimientos", "Opérations", "Buchungen", "取引"],
    ["Gráficos", "Charts", "Gráficos", "Graphiques", "Diagramme", "グラフ"],
    ["Última tela utilizada", "Last screen used", "Última pantalla utilizada", "Dernier écran utilisé", "Zuletzt verwendeter Bildschirm", "最後に使用した画面"],
    ["Mês de referência", "Reference month", "Mes de referencia", "Mois de référence", "Referenzmonat", "基準月"],
    ["Abrir no mês atual", "Open current month", "Abrir en el mes actual", "Ouvrir le mois actuel", "Aktuellen Monat öffnen", "今月を開く"],
    ["Preservar último acesso", "Keep last selection", "Conservar el último acceso", "Conserver le dernier accès", "Letzte Auswahl beibehalten", "前回の選択を保持"],
    ["O dia inicial do período financeiro não está disponível: os cálculos atuais usam meses do calendário.", "A custom start day is unavailable; calculations use calendar months.", "No se puede elegir el día inicial; los cálculos usan meses naturales.", "Le jour de début personnalisé n’est pas disponible ; les calculs utilisent les mois calendaires.", "Ein benutzerdefinierter Starttag ist nicht verfügbar; es werden Kalendermonate verwendet.", "開始日の個別設定はできません。計算には暦月を使用します。"],
    ["Exibir Despesas do mês na tela inicial", "Show Monthly expenses on the home screen", "Mostrar gastos del mes en la pantalla de inicio", "Afficher les dépenses du mois sur l’écran d’accueil", "Monatsausgaben auf dem Startbildschirm anzeigen", "ホーム画面に今月の支出を表示"],
    ["Exibir Entradas na tela inicial", "Show Income on the home screen", "Mostrar ingresos en la pantalla de inicio", "Afficher les revenus sur l’écran d’accueil", "Einnahmen auf dem Startbildschirm anzeigen", "ホーム画面に収入を表示"],
    ["Idioma e moeda", "Language and currency", "Idioma y moneda", "Langue et devise", "Sprache und Währung", "言語と通貨"],
    ["Idioma", "Language", "Idioma", "Langue", "Sprache", "言語"],
    ["Moeda de exibição", "Display currency", "Moneda de visualización", "Devise d’affichage", "Anzeigewährung", "表示通貨"],
    ["Real brasileiro (BRL)", "Brazilian real (BRL)", "Real brasileño (BRL)", "Réal brésilien (BRL)", "Brasilianischer Real (BRL)", "ブラジルレアル (BRL)"],
    ["Dólar americano (USD)", "US dollar (USD)", "Dólar estadounidense (USD)", "Dollar américain (USD)", "US-Dollar (USD)", "米ドル (USD)"],
    ["Euro (EUR)", "Euro (EUR)", "Euro (EUR)", "Euro (EUR)", "Euro (EUR)", "ユーロ (EUR)"],
    ["Iene japonês (JPY)", "Japanese yen (JPY)", "Yen japonés (JPY)", "Yen japonais (JPY)", "Japanischer Yen (JPY)", "日本円 (JPY)"],
    ["A moeda altera somente a apresentação dos valores. Os números armazenados não são convertidos.", "The currency changes only how amounts are displayed. Stored numbers are not converted.", "La moneda solo cambia la presentación de los importes. Los valores guardados no se convierten.", "La devise ne modifie que l’affichage des montants. Les valeurs enregistrées ne sont pas converties.", "Die Währung ändert nur die Darstellung. Gespeicherte Zahlen werden nicht umgerechnet.", "通貨設定は金額の表示のみを変更します。保存済みの数値は換算されません。"],
    ["Iniciar com valores ocultos", "Start with amounts hidden", "Iniciar con importes ocultos", "Démarrer avec les montants masqués", "Mit ausgeblendeten Beträgen starten", "金額を非表示で起動"],
    ["Ocultar valores financeiros", "Hide financial amounts", "Ocultar importes financieros", "Masquer les montants financiers", "Finanzbeträge ausblenden", "金額を非表示"],
    ["Mostrar valores", "Show amounts", "Mostrar importes", "Afficher les montants", "Beträge anzeigen", "金額を表示"],
    ["Ocultar valores", "Hide amounts", "Ocultar importes", "Masquer les montants", "Beträge ausblenden", "金額を非表示"],
    ["do resumo", "in summary", "del resumen", "du résumé", "in der Übersicht", "（サマリー）"],
    ["Dados e segurança", "Data and safety", "Datos y seguridad", "Données et sécurité", "Daten und Sicherheit", "データと安全性"],
    ["Período do CSV", "CSV range", "Período del CSV", "Période du CSV", "CSV-Zeitraum", "CSVの期間"],
    ["Mês selecionado", "Selected month", "Mes seleccionado", "Mois sélectionné", "Ausgewählter Monat", "選択した月"],
    ["Todos os meses", "All months", "Todos los meses", "Tous les mois", "Alle Monate", "すべての月"],
    ["Copiar mês anterior", "Copy previous month", "Copiar mes anterior", "Copier le mois précédent", "Vorherigen Monat kopieren", "前月をコピー"],
    ["Exportar CSV", "Export CSV", "Exportar CSV", "Exporter CSV", "CSV exportieren", "CSVを書き出す"],
    ["Salvar backup", "Save backup", "Guardar copia de seguridad", "Enregistrer la sauvegarde", "Sicherung speichern", "バックアップを保存"],
    ["Restaurar backup", "Restore backup", "Restaurar copia de seguridad", "Restaurer la sauvegarde", "Sicherung wiederherstellen", "バックアップを復元"],
    ["Limpar mês", "Clear month", "Borrar mes", "Effacer le mois", "Monat leeren", "月をクリア"],
    ["Restaurar substitui todos os dados atuais; o app pede confirmação antes da troca. Seus dados ficam neste dispositivo. Faça backups periodicamente.", "Restore replaces all current data; the app asks for confirmation first. Your data stays on this device. Make backups regularly.", "La restauración sustituye todos los datos actuales y solicita confirmación. Tus datos permanecen en este dispositivo. Haz copias periódicas.", "La restauration remplace toutes les données actuelles après confirmation. Vos données restent sur cet appareil. Effectuez des sauvegardes régulièrement.", "Beim Wiederherstellen werden nach Bestätigung alle aktuellen Daten ersetzt. Deine Daten bleiben auf diesem Gerät. Erstelle regelmäßig Sicherungen.", "復元すると確認後に現在のデータがすべて置き換わります。データはこの端末に保存されます。定期的にバックアップしてください。"],
    ["Nenhum backup ou restauração registrado nesta instalação.", "No backup or restore recorded in this installation.", "No hay copias de seguridad ni restauraciones registradas en esta instalación.", "Aucune sauvegarde ni restauration enregistrée dans cette installation.", "In dieser Installation wurden keine Sicherungen oder Wiederherstellungen erfasst.", "このインストールではバックアップや復元は記録されていません。"],
    ["Backup JSON gerado em", "JSON backup created on", "Copia JSON generada el", "Sauvegarde JSON créée le", "JSON-Sicherung erstellt am", "JSONバックアップ作成日時:"],
    ["Backup restaurado em", "Backup restored on", "Copia restaurada el", "Sauvegarde restaurée le", "Sicherung wiederhergestellt am", "バックアップ復元日時:"],
    ["Dados financeiros existentes não puderam ser validados. A gravação automática foi bloqueada; restaure um backup válido em Opções.", "Existing financial data could not be validated. Automatic saving is blocked; restore a valid backup in Options.", "No se pudieron validar los datos financieros existentes. Se bloqueó el guardado automático; restaura una copia válida en Opciones.", "Les données financières existantes n’ont pas pu être validées. L’enregistrement automatique est bloqué ; restaurez une sauvegarde valide dans Options.", "Vorhandene Finanzdaten konnten nicht validiert werden. Das automatische Speichern ist blockiert; stelle unter Optionen eine gültige Sicherung wieder her.", "既存の家計データを検証できませんでした。自動保存を停止しました。オプションから有効なバックアップを復元してください。"],
    ["Baixar cópia preservada", "Download preserved copy", "Descargar copia preservada", "Télécharger la copie préservée", "Gesicherte Kopie herunterladen", "保存されたコピーをダウンロード"],
    ["Cópia bruta dos dados preservados gerada.", "Raw copy of preserved data created.", "Se creó una copia sin modificar de los datos preservados.", "Copie brute des données préservées créée.", "Unveränderte Kopie der erhaltenen Daten erstellt.", "保持データの未加工コピーを作成しました。"],
    ["lançamentos (", "transactions (", "movimientos (", "opérations (", "Buchungen (", "件の取引（"],
    ["receitas,", "income,", "ingresos,", "revenus,", "Einnahmen,", "件の収入、"],
    ["despesas) ·", "expenses) ·", "gastos) ·", "dépenses) ·", "Ausgaben) ·", "件の支出）・"],
    ["categorias ·", "categories ·", "categorías ·", "catégories ·", "Kategorien ·", "カテゴリ・"],
    ["Armazenamento persistente disponível.", "Persistent storage available.", "Almacenamiento persistente disponible.", "Stockage persistant disponible.", "Dauerhafter Speicher verfügbar.", "永続ストレージを利用できます。"],
    ["Armazenamento em memória: os dados podem se perder ao recarregar ou fechar o app.", "In-memory storage: data may be lost when the app reloads or closes.", "Almacenamiento en memoria: los datos podrían perderse al recargar o cerrar la aplicación.", "Stockage en mémoire : les données peuvent être perdues au rechargement ou à la fermeture de l’application.", "Nur Arbeitsspeicher: Daten können beim Neuladen oder Schließen der App verloren gehen.", "メモリ上の保存です。再読み込みや終了時にデータが失われる可能性があります。"],
    ["Service Worker ainda não consultado.", "Service Worker status not checked yet.", "Estado del Service Worker aún no consultado.", "État du Service Worker pas encore vérifié.", "Service-Worker-Status noch nicht abgefragt.", "Service Workerの状態はまだ確認されていません。"],
    ["Service Worker ainda não registrado.", "Service Worker not registered yet.", "Service Worker aún no registrado.", "Service Worker pas encore enregistré.", "Service Worker noch nicht registriert.", "Service Workerはまだ登録されていません。"],
    ["Service Worker não é suportado neste navegador.", "Service Workers are not supported in this browser.", "Este navegador no admite Service Workers.", "Les Service Workers ne sont pas pris en charge par ce navigateur.", "Dieser Browser unterstützt keine Service Worker.", "このブラウザーはService Workerに対応していません。"],
    ["Nova instalação do Service Worker aguardando confirmação.", "A new Service Worker installation is waiting for confirmation.", "Una nueva instalación del Service Worker espera confirmación.", "Une nouvelle installation du Service Worker attend une confirmation.", "Eine neue Service-Worker-Installation wartet auf Bestätigung.", "新しいService Workerのインストールが確認待ちです。"],
    ["Service Worker instalando (", "Service Worker installing (", "Service Worker instalándose (", "Service Worker en cours d’installation (", "Service Worker wird installiert (", "Service Workerをインストール中（"],
    ["Service Worker ativo (", "Service Worker active (", "Service Worker activo (", "Service Worker actif (", "Service Worker aktiv (", "Service Worker有効（"],
    ["); controlando esta página.", "); controlling this page.", "); controlando esta página.", "); contrôle cette page.", "); steuert diese Seite.", "）このページを制御中。"],
    ["); a página ainda não está sob controle.", "); this page is not controlled yet.", "); la página aún no está bajo control.", "); cette page n’est pas encore contrôlée.", "); diese Seite wird noch nicht gesteuert.", "）このページはまだ制御されていません。"],
    ["Registro do Service Worker sem worker ativo.", "Service Worker registration has no active worker.", "El registro del Service Worker no tiene un worker activo.", "L’enregistrement du Service Worker n’a aucun worker actif.", "Die Service-Worker-Registrierung hat keinen aktiven Worker.", "Service Workerの登録に有効なWorkerがありません。"],
    ["Não foi possível consultar o Service Worker:", "Could not check the Service Worker:", "No se pudo consultar el Service Worker:", "Impossible de vérifier le Service Worker :", "Service Worker konnte nicht abgefragt werden:", "Service Workerを確認できませんでした:"],
    ["Service Worker ativo e controlando esta página.", "Service Worker is active and controlling this page.", "Service Worker activo y controlando esta página.", "Service Worker actif et contrôlant cette page.", "Service Worker ist aktiv und steuert diese Seite.", "Service Workerが有効でこのページを制御しています。"],
    ["Nova versão instalada e controlando esta página.", "New version installed and controlling this page.", "Nueva versión instalada y controlando esta página.", "Nouvelle version installée et contrôlant cette page.", "Neue Version installiert und steuert diese Seite.", "新しいバージョンがインストールされ、このページを制御しています。"],
    ["Armazenamento: persistente disponível.", "Storage: persistent storage available.", "Almacenamiento: almacenamiento persistente disponible.", "Stockage : stockage persistant disponible.", "Speicher: dauerhafter Speicher verfügbar.", "ストレージ: 永続ストレージを利用できます。"],
    ["Armazenamento: somente memória; os dados podem se perder ao recarregar ou fechar o app.", "Storage: memory only; data may be lost when reloading or closing the app.", "Almacenamiento: solo memoria; los datos podrían perderse al recargar o cerrar la aplicación.", "Stockage : mémoire uniquement ; les données peuvent être perdues au rechargement ou à la fermeture de l’application.", "Speicher: nur Arbeitsspeicher; Daten können beim Neuladen oder Schließen der App verloren gehen.", "ストレージ: メモリのみ。再読み込みや終了時にデータが失われる可能性があります。"],
    ["Sobre e diagnóstico", "About and diagnostics", "Acerca de y diagnóstico", "À propos et diagnostic", "Info und Diagnose", "情報と診断"],
    ["Nome: Controle Financeiro", "Name: Controle Financeiro", "Nombre: Controle Financeiro", "Nom : Controle Financeiro", "Name: Controle Financeiro", "名前: Controle Financeiro"],
    ["Não registrada.", "Not recorded.", "No registrada.", "Non enregistrée.", "Nicht erfasst.", "未記録。"],
    ["Não verificada.", "Not checked.", "No verificada.", "Non vérifiée.", "Nicht geprüft.", "未確認。"],
    ["Consultando…", "Checking…", "Consultando…", "Vérification…", "Wird geprüft…", "確認中…"],
    ["Versão instalada:", "Installed version:", "Versión instalada:", "Version installée :", "Installierte Version:", "インストール済みバージョン:"],
    ["Versão publicada:", "Latest published version:", "Versión publicada:", "Dernière version publiée :", "Zuletzt veröffentlichte Version:", "公開バージョン:"],
    ["Última verificação:", "Last check:", "Última comprobación:", "Dernière vérification :", "Letzte Prüfung:", "最終確認:"],
    ["Resultado:", "Result:", "Resultado:", "Résultat :", "Ergebnis:", "結果:"],
    ["Atualizações", "Updates", "Actualizaciones", "Mises à jour", "Updates", "更新"],
    ["Verificar atualização", "Check for updates", "Buscar actualizaciones", "Vérifier les mises à jour", "Nach Updates suchen", "更新を確認"],
    ["A versão publicada será consultada quando houver conexão.", "The published version will be checked when you are online.", "Se comprobará la versión publicada cuando haya conexión.", "La version publiée sera vérifiée lorsque vous serez en ligne.", "Die veröffentlichte Version wird bei bestehender Verbindung geprüft.", "オンライン時に公開バージョンを確認します。"],
    ["Calculadora", "Calculator", "Calculadora", "Calculatrice", "Taschenrechner", "電卓"],
    ["Expressão e resultado", "Expression and result", "Expresión y resultado", "Expression et résultat", "Ausdruck und Ergebnis", "式と結果"],
    ["Adicionar despesa", "Add expense", "Añadir gasto", "Ajouter une dépense", "Ausgabe hinzufügen", "支出を追加"],
    ["Editar despesa", "Edit expense", "Editar gasto", "Modifier la dépense", "Ausgabe bearbeiten", "支出を編集"],
    ["Adicionar entrada", "Add income", "Añadir ingreso", "Ajouter un revenu", "Einnahme hinzufügen", "収入を追加"],
    ["Editar entrada", "Edit income", "Editar ingreso", "Modifier le revenu", "Einnahme bearbeiten", "収入を編集"],
    ["Nome", "Name", "Nombre", "Nom", "Name", "名前"],
    ["Categoria", "Category", "Categoría", "Catégorie", "Kategorie", "カテゴリ"],
    ["Valor", "Amount", "Importe", "Montant", "Betrag", "金額"],
    ["Repetição", "Repeat", "Repetición", "Répétition", "Wiederholung", "繰り返し"],
    ["Não se repete", "Does not repeat", "No se repite", "Ne se répète pas", "Keine Wiederholung", "繰り返さない"],
    ["Fixa (12 meses)", "Fixed (12 months)", "Fijo (12 meses)", "Fixe (12 mois)", "Fest (12 Monate)", "固定（12か月）"],
    ["Parcelada", "Installments", "A plazos", "Échelonné", "Ratenzahlung", "分割払い"],
    ["Número de parcelas", "Number of installments", "Número de cuotas", "Nombre d’échéances", "Anzahl der Raten", "分割回数"],
    ["O valor acima é o de cada parcela. As demais entram nos meses seguintes.", "The amount above is per installment. The remaining installments are added to following months.", "El importe anterior es por cuota. Las demás se añaden a los meses siguientes.", "Le montant ci-dessus est celui de chaque échéance. Les autres sont ajoutées aux mois suivants.", "Der Betrag oben gilt pro Rate. Weitere Raten werden den Folgemonaten hinzugefügt.", "上記の金額は各回の金額です。残りは翌月以降に追加されます。"],
    ["Já está paga", "Already paid", "Ya está pagado", "Déjà payée", "Bereits bezahlt", "支払い済み"],
    ["Aplicar também às próximas", "Also apply to future items", "Aplicar también a las siguientes", "Appliquer également aux suivantes", "Auch auf zukünftige anwenden", "以降にも適用"],
    ["Cancelar", "Cancel", "Cancelar", "Annuler", "Abbrechen", "キャンセル"],
    ["Salvar", "Save", "Guardar", "Enregistrer", "Speichern", "保存"],
    ["Remover despesa", "Remove expense", "Eliminar gasto", "Supprimer la dépense", "Ausgabe entfernen", "支出を削除"],
    ["Só este mês", "This month only", "Solo este mes", "Ce mois uniquement", "Nur diesen Monat", "今月のみ"],
    ["Este e os próximos", "This and future months", "Este y los siguientes", "Ce mois et les suivants", "Diesen und folgende Monate", "今月と翌月以降"],
    ["Categorias e orçamentos", "Categories and budgets", "Categorías y presupuestos", "Catégories et budgets", "Kategorien und Budgets", "カテゴリと予算"],
    ["Gerenciar categorias", "Manage categories", "Gestionar categorías", "Gérer les catégories", "Kategorien verwalten", "カテゴリを管理"],
    ["Configurar limites de orçamento", "Configure budget limits", "Configurar límites del presupuesto", "Configurer les limites du budget", "Budgetlimits konfigurieren", "予算上限を設定"],
    ["Voltar", "Back", "Volver", "Retour", "Zurück", "戻る"],
    ["Categorias", "Categories", "Categorías", "Catégories", "Kategorien", "カテゴリ"],
    ["Adicione, renomeie ou remova categorias usadas nos lançamentos e orçamentos.", "Add, rename, or remove categories used in transactions and budgets.", "Añade, cambia el nombre o elimina categorías de movimientos y presupuestos.", "Ajoutez, renommez ou supprimez les catégories utilisées dans les opérations et les budgets.", "Füge Kategorien für Buchungen und Budgets hinzu, benenne sie um oder entferne sie.", "取引や予算で使うカテゴリを追加、名前変更、削除できます。"],
    ["Nome da nova categoria", "New category name", "Nombre de la nueva categoría", "Nom de la nouvelle catégorie", "Name der neuen Kategorie", "新しいカテゴリ名"],
    ["Adicionar categoria", "Add category", "Añadir categoría", "Ajouter une catégorie", "Kategorie hinzufügen", "カテゴリを追加"],
    ["Salvar limite", "Save limit", "Guardar límite", "Enregistrer la limite", "Limit speichern", "上限を保存"],
    ["Remover limite", "Remove limit", "Eliminar límite", "Supprimer la limite", "Limit entfernen", "上限を削除"],
    ["padrão", "default", "predeterminado", "par défaut", "Standard", "標準"],
    ["Renomear", "Rename", "Cambiar nombre", "Renommer", "Umbenennen", "名前を変更"],
    ["Remover", "Remove", "Eliminar", "Supprimer", "Entfernen", "削除"],
    ["Desfazer", "Undo", "Deshacer", "Annuler", "Rückgängig", "元に戻す"],
    ["Fixa", "Fixed", "Fijo", "Fixe", "Fest", "固定"],
    ["Despesa paga", "Expense paid", "Gasto pagado", "Dépense payée", "Ausgabe bezahlt", "支払い済みの支出"],
    ["Limites mensais por categoria", "Monthly limits by category", "Límites mensuales por categoría", "Limites mensuelles par catégorie", "Monatliche Limits nach Kategorie", "カテゴリ別の月間上限"],
    ["Limite mensal padrão", "Default monthly limit", "Límite mensual predeterminado", "Limite mensuelle par défaut", "Monatliches Standardlimit", "月間標準上限"],
    ["Os limites valem para todos os meses. Categorias sem limite ficam sem orçamento.", "Each limit is a default applied automatically every month. Categories without a limit remain unbudgeted.", "Cada límite es predeterminado y se aplica automáticamente cada mes. Las categorías sin límite siguen sin presupuesto.", "Chaque limite est appliqué automatiquement chaque mois. Les catégories sans limite restent sans budget.", "Jedes Limit gilt standardmäßig automatisch für alle Monate. Kategorien ohne Limit bleiben ohne Budget.", "各上限は毎月の標準値として自動適用されます。上限のないカテゴリは予算なしのままです。"],
    ["Gasto:", "Spent:", "Gastado:", "Dépensé :", "Ausgegeben:", "支出:"],
    ["Limite:", "Limit:", "Límite:", "Limite :", "Limit:", "上限:"],
    ["Restante:", "Remaining:", "Restante:", "Restant :", "Übrig:", "残り:"],
    ["Excesso:", "Over:", "Exceso:", "Dépassement :", "Überschritten:", "超過:"],
    ["consumido", "used", "consumido", "utilisé", "verbraucht", "使用済み"],
    ["Sem orçamento definido", "No budget set", "Sin presupuesto definido", "Aucun budget défini", "Kein Budget festgelegt", "予算未設定"],
    ["Mudar para", "Switch to", "Cambiar a", "Passer à", "Wechseln zu", "切り替え"],
    ["Não foi possível salvar os dados neste dispositivo.", "Could not save data on this device.", "No se pudieron guardar los datos en este dispositivo.", "Impossible d’enregistrer les données sur cet appareil.", "Daten konnten auf diesem Gerät nicht gespeichert werden.", "この端末にデータを保存できませんでした。"],
    ["O armazenamento persistente está indisponível. Os dados podem se perder ao fechar o app.", "Persistent storage is unavailable. Data may be lost when the app closes.", "El almacenamiento persistente no está disponible. Los datos podrían perderse al cerrar la aplicación.", "Le stockage persistant est indisponible. Les données peuvent être perdues à la fermeture de l’application.", "Dauerhafter Speicher ist nicht verfügbar. Daten können beim Schließen der App verloren gehen.", "永続ストレージを利用できません。アプリを閉じるとデータが失われる可能性があります。"],
    ["Informe um limite válido igual ou maior que zero.", "Enter a valid limit of zero or more.", "Introduce un límite válido igual o mayor que cero.", "Saisissez une limite valide supérieure ou égale à zéro.", "Gib ein gültiges Limit von mindestens null ein.", "0以上の有効な上限を入力してください。"],
    ["Exclusão desfeita.", "Deletion undone.", "Eliminación deshecha.", "Suppression annulée.", "Löschung rückgängig gemacht.", "削除を取り消しました。"],
    ["Digite o nome da entrada.", "Enter an income name.", "Escribe el nombre del ingreso.", "Saisissez le nom du revenu.", "Gib einen Einnahmennamen ein.", "収入名を入力してください。"],
    ["Informe um valor maior que zero para a entrada.", "Enter an amount greater than zero for the income.", "Introduce un importe mayor que cero para el ingreso.", "Saisissez un montant supérieur à zéro pour le revenu.", "Gib für die Einnahme einen Betrag größer null ein.", "収入に0より大きい金額を入力してください。"],
    ["Entrada atualizada.", "Income updated.", "Ingreso actualizado.", "Revenu modifié.", "Einnahme aktualisiert.", "収入を更新しました。"],
    ["Entrada adicionada.", "Income added.", "Ingreso añadido.", "Revenu ajouté.", "Einnahme hinzugefügt.", "収入を追加しました。"],
    ["Digite o nome da despesa.", "Enter an expense name.", "Escribe el nombre del gasto.", "Saisissez le nom de la dépense.", "Gib einen Ausgabennamen ein.", "支出名を入力してください。"],
    ["Informe um valor maior que zero para a despesa.", "Enter an amount greater than zero for the expense.", "Introduce un importe mayor que cero para el gasto.", "Saisissez un montant supérieur à zéro pour la dépense.", "Gib für die Ausgabe einen Betrag größer null ein.", "支出に0より大きい金額を入力してください。"],
    ["Despesa adicionada.", "Expense added.", "Gasto añadido.", "Dépense ajoutée.", "Ausgabe hinzugefügt.", "支出を追加しました。"],
    ["Digite o nome da categoria.", "Enter a category name.", "Escribe el nombre de la categoría.", "Saisissez un nom de catégorie.", "Gib einen Kategorienamen ein.", "カテゴリ名を入力してください。"],
    ["Essa categoria já existe.", "This category already exists.", "Esta categoría ya existe.", "Cette catégorie existe déjà.", "Diese Kategorie existiert bereits.", "このカテゴリは既に存在します。"],
    ["Categoria adicionada.", "Category added.", "Categoría añadida.", "Catégorie ajoutée.", "Kategorie hinzugefügt.", "カテゴリを追加しました。"],
    ["Categoria renomeada.", "Category renamed.", "Categoría renombrada.", "Catégorie renommée.", "Kategorie umbenannt.", "カテゴリ名を変更しました。"],
    ["Categoria removida.", "Category removed.", "Categoría eliminada.", "Catégorie supprimée.", "Kategorie entfernt.", "カテゴリを削除しました。"],
    ["Limite mensal salvo.", "Monthly limit saved.", "Límite mensual guardado.", "Limite mensuelle enregistrée.", "Monatslimit gespeichert.", "月間上限を保存しました。"],
    ["Limite mensal removido.", "Monthly limit removed.", "Límite mensual eliminado.", "Limite mensuelle supprimée.", "Monatslimit entfernt.", "月間上限を削除しました。"],
    ["Informe um ano entre 2000 e 2100.", "Enter a year between 2000 and 2100.", "Introduce un año entre 2000 y 2100.", "Saisissez une année entre 2000 et 2100.", "Gib ein Jahr zwischen 2000 und 2100 ein.", "2000から2100までの年を入力してください。"],
    ["Este mês já está vazio.", "This month is already empty.", "Este mes ya está vacío.", "Ce mois est déjà vide.", "Dieser Monat ist bereits leer.", "今月はすでに空です。"],
    ["Mês limpo.", "Month cleared.", "Mes borrado.", "Mois effacé.", "Monat geleert.", "月をクリアしました。"],
    ["Não há lançamentos neste período para exportar.", "There are no transactions to export for this period.", "No hay movimientos que exportar en este período.", "Aucune opération à exporter pour cette période.", "Für diesen Zeitraum gibt es keine Buchungen zum Exportieren.", "この期間にエクスポートする取引はありません。"],
    ["Arquivo CSV gerado.", "CSV file created.", "Archivo CSV generado.", "Fichier CSV créé.", "CSV-Datei erstellt.", "CSVファイルを作成しました。"],
    ["Backup salvo.", "Backup saved.", "Copia de seguridad guardada.", "Sauvegarde enregistrée.", "Sicherung gespeichert.", "バックアップを保存しました。"],
    ["Backup restaurado.", "Backup restored.", "Copia de seguridad restaurada.", "Sauvegarde restaurée.", "Sicherung wiederhergestellt.", "バックアップを復元しました。"],
    ["Não foi possível ler o arquivo.", "Could not read the file.", "No se pudo leer el archivo.", "Impossible de lire le fichier.", "Datei konnte nicht gelesen werden.", "ファイルを読み込めませんでした。"],
    ["Verificando…", "Checking…", "Comprobando…", "Vérification…", "Wird geprüft…", "確認中…"],
    ["Consultando a versão publicada e o estado do Service Worker…", "Checking the published version and Service Worker status…", "Consultando la versión publicada y el estado del Service Worker…", "Vérification de la version publiée et de l’état du Service Worker…", "Veröffentlichte Version und Service-Worker-Status werden geprüft…", "公開バージョンとService Workerの状態を確認しています…"]
];

const IDIOMAS = ["pt-BR", "en", "es", "fr", "de", "ja"];
const COLUNAS_IDIOMA = { "pt-BR": 0, en: 1, es: 2, fr: 3, de: 4, ja: 5 };
const FRASES_POR_IDIOMA = Object.fromEntries(IDIOMAS.map((idioma) => [
    idioma,
    new Map(FRASES.map((linha) => [linha[0], linha[COLUNAS_IDIOMA[idioma]]]))
]));
const textoOriginal = new WeakMap();
const atributoOriginal = new WeakMap();
let idiomaAtivo = "pt-BR";
let observador = null;

// Translate only a complete UI phrase/template. Captured values are opaque:
// category names, descriptions, amounts and account identifiers are never retranslated.
const escaparRegex = value => [...value].map(c => '^$.*+?()[]{}|'.includes(c) || c.charCodeAt(0) === 92 ? String.fromCharCode(92) + c : c).join('');
const modelos = FRASES.filter(linha => /[{][0-9]+[}]/.test(linha[0])).map(linha => {
    const partes = linha[0].split(/([{][0-9]+[}])/g), indices = [];
    const pattern = partes.map(parte => {
        if (/^[{][0-9]+[}]$/.test(parte)) { indices.push(parte); return '(.*?)'; }
        return escaparRegex(parte);
    }).join('');
    return { linha, indices, regex: new RegExp('^' + pattern + '$', 's') };
}).sort((a,b) => b.linha[0].replace(/[{][0-9]+[}]/g,'').length - a.linha[0].replace(/[{][0-9]+[}]/g,'').length);

function textoTraduzido(texto, idioma = idiomaAtivo) {
    if (typeof texto !== 'string' || !IDIOMAS.includes(idioma) || idioma === 'pt-BR') return texto;
    const original = texto.trim(), exato = FRASES_POR_IDIOMA[idioma].get(original);
    if (exato) return texto.replace(original, () => exato);
    for (const {linha, indices, regex} of modelos) {
        const match = regex.exec(original);
        if (!match) continue;
        const valores = new Map(indices.map((key,index) => [key,match[index+1]]));
        const traduzido = linha[COLUNAS_IDIOMA[idioma]].replace(/[{][0-9]+[}]/g,key => valores.get(key) ?? key);
        return texto.replace(original, () => traduzido);
    }
    return texto;
}

function devePreservarTexto(no) {
    const pai = no.parentElement;
    return Boolean(pai?.closest(
        ".nome-receita, .nome-despesa, .grafico-categoria-nome, .despesa-grupo-categoria, .orcamento-edicao legend, " +
        "#lista-categorias .nome, #despesa-categoria, script, style, code, pre, textarea, [data-i18n-preserve], [data-i18n-date]"
    ));
}

function traduzirNoTexto(no) {
    if (devePreservarTexto(no)) return;
    const atual = no.nodeValue;
    const salvo = textoOriginal.get(no);
    const original = salvo && salvo.traduzido === atual ? salvo.original : atual;
    const traduzido = textoTraduzido(original);
    textoOriginal.set(no, { original, traduzido });
    if (atual !== traduzido) no.nodeValue = traduzido;
}

function traduzirAtributos(elemento) {
    if (elemento.closest('[data-i18n-preserve], script, style, code, pre')) return;
    const date = elemento.getAttribute('data-i18n-date');
    if (date && elemento.textContent && Number.isFinite(Date.parse(date))) {
        const texto = textoTraduzido('Última sincronização confirmada:') + ' ' + new Date(date).toLocaleString(LOCALES[idiomaAtivo]);
        if (elemento.textContent !== texto) elemento.textContent = texto;
    }
    for (const atributo of ["aria-label", "aria-valuetext", "title", "placeholder", "alt"]) {
        if (atributo === 'aria-label' && elemento.hasAttribute('data-i18n-preserve-aria')) continue;
        if (!elemento.hasAttribute(atributo)) continue;
        const atual = elemento.getAttribute(atributo);
        let originais = atributoOriginal.get(elemento);
        if (!originais) {
            originais = new Map();
            atributoOriginal.set(elemento, originais);
        }
        const salvo = originais.get(atributo);
        const original = salvo && salvo.traduzido === atual ? salvo.original : atual;
        const traduzido = textoTraduzido(original);
        originais.set(atributo, { original, traduzido });
        if (atual !== traduzido) elemento.setAttribute(atributo, traduzido);
    }
}

function traduzirArvore(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === Node.TEXT_NODE) {
        traduzirNoTexto(raiz);
        return;
    }
    const elementoRaiz = raiz.nodeType === Node.DOCUMENT_NODE ? raiz.documentElement : raiz;
    const elementos = elementoRaiz?.nodeType === Node.ELEMENT_NODE
        ? [elementoRaiz, ...elementoRaiz.querySelectorAll("*")]
        : [];
    elementos.forEach(traduzirAtributos);
    const arvore = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    while (arvore.nextNode()) traduzirNoTexto(arvore.currentNode);
}

export function aplicarIdioma(idioma, raiz = document) {
    idiomaAtivo = IDIOMAS.includes(idioma) ? idioma : "pt-BR";
    document.documentElement.lang = idiomaAtivo;
    traduzirArvore(raiz);
    if (!observador && typeof MutationObserver !== "undefined") {
        observador = new MutationObserver((mutacoes) => {
            mutacoes.forEach((mutacao) => {
                if (mutacao.type === "characterData") traduzirNoTexto(mutacao.target);
                else if (mutacao.type === "attributes") traduzirAtributos(mutacao.target);
                else mutacao.addedNodes.forEach(traduzirArvore);
            });
        });
        observador.observe(document.documentElement, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["aria-label", "aria-valuetext", "title", "placeholder", "alt", "data-i18n-date"]
        });
    }
}

export function formatarMoeda(valor, moeda = "BRL", idioma = "pt-BR") {
    const locale = LOCALES[idioma] || LOCALES["pt-BR"];
    const currency = MOEDAS.includes(moeda) ? moeda : "BRL";
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(valor);
}

export { IDIOMAS, LOCALES, MOEDAS, textoTraduzido };
