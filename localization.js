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
    ["nos últimos três meses:", "over the last three months:", "en los últimos tres meses:", "au cours des trois derniers mois :", "in den letzten drei Monaten:", "過去3か月:"],
    ["Nenhuma despesa com valor registrado em", "No expenses with an amount recorded in", "No hay gastos con importe registrado en", "Aucune dépense avec un montant enregistré en", "Keine Ausgaben mit erfasstem Betrag in", "金額が記録された支出はありません:"],
    ["3 meses", "3 months", "3 meses", "3 mois", "3 Monate", "3か月"],
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
    ["Entradas e despesas", "Income and expenses", "Ingresos y gastos", "Revenus et dépenses", "Einnahmen und Ausgaben", "収入と支出"],
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
    ["Mostrar gráficos", "Show charts", "Mostrar gráficos", "Afficher les graphiques", "Diagramme anzeigen", "グラフを表示"],
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
    [" do resumo", " in summary", " del resumen", " du résumé", " in der Übersicht", "（サマリー）"],
    [" financeiros", "", " financieros", " financiers", "", ""],
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
    ["Backup JSON gerado em ", "JSON backup created on ", "Copia JSON generada el ", "Sauvegarde JSON créée le ", "JSON-Sicherung erstellt am ", "JSONバックアップ作成日時: "],
    ["Backup restaurado em ", "Backup restored on ", "Copia restaurada el ", "Sauvegarde restaurée le ", "Sicherung wiederhergestellt am ", "バックアップ復元日時: "],
    ["Dados financeiros existentes não puderam ser validados. A gravação automática foi bloqueada; restaure um backup válido em Opções.", "Existing financial data could not be validated. Automatic saving is blocked; restore a valid backup in Options.", "No se pudieron validar los datos financieros existentes. Se bloqueó el guardado automático; restaura una copia válida en Opciones.", "Les données financières existantes n’ont pas pu être validées. L’enregistrement automatique est bloqué ; restaurez une sauvegarde valide dans Options.", "Vorhandene Finanzdaten konnten nicht validiert werden. Das automatische Speichern ist blockiert; stelle unter Optionen eine gültige Sicherung wieder her.", "既存の家計データを検証できませんでした。自動保存を停止しました。オプションから有効なバックアップを復元してください。"],
    [" Dados existentes não foram alterados; gravação automática bloqueada.", " Existing data was not changed; automatic saving is blocked.", " Los datos existentes no se modificaron; el guardado automático está bloqueado.", " Les données existantes n’ont pas été modifiées ; l’enregistrement automatique est bloqué.", " Vorhandene Daten wurden nicht geändert; automatisches Speichern ist blockiert.", " 既存データは変更されていません。自動保存を停止しました。"],
    ["Baixar cópia preservada", "Download preserved copy", "Descargar copia preservada", "Télécharger la copie préservée", "Gesicherte Kopie herunterladen", "保存されたコピーをダウンロード"],
    ["Cópia bruta dos dados preservados gerada.", "Raw copy of preserved data created.", "Se creó una copia sin modificar de los datos preservados.", "Copie brute des données préservées créée.", "Unveränderte Kopie der erhaltenen Daten erstellt.", "保持データの未加工コピーを作成しました。"],
    [" lançamentos (", " transactions (", " movimientos (", " opérations (", " Buchungen (", " 件の取引（"],
    [" receitas, ", " income, ", " ingresos, ", " revenus, ", " Einnahmen, ", " 件の収入、"],
    [" despesas) · ", " expenses) · ", " gastos) · ", " dépenses) · ", " Ausgaben) · ", " 件の支出）・"],
    [" categorias · ", " categories · ", " categorías · ", " catégories · ", " Kategorien · ", " カテゴリ・"],
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
    ["Não foi possível consultar o Service Worker: ", "Could not check the Service Worker: ", "No se pudo consultar el Service Worker: ", "Impossible de vérifier le Service Worker : ", "Service Worker konnte nicht abgefragt werden: ", "Service Workerを確認できませんでした: "],
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
    ["Cada limite é padrão e será aplicado automaticamente em todos os meses. Categorias sem limite continuam sem orçamento configurado.", "Each limit is a default applied automatically every month. Categories without a limit remain unbudgeted.", "Cada límite es predeterminado y se aplica automáticamente cada mes. Las categorías sin límite siguen sin presupuesto.", "Chaque limite est appliqué automatiquement chaque mois. Les catégories sans limite restent sans budget.", "Jedes Limit gilt standardmäßig automatisch für alle Monate. Kategorien ohne Limit bleiben ohne Budget.", "各上限は毎月の標準値として自動適用されます。上限のないカテゴリは予算なしのままです。"],
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

function textoTraduzido(texto, idioma = idiomaAtivo) {
    if (!IDIOMAS.includes(idioma) || idioma === "pt-BR") return texto;
    const frases = FRASES_POR_IDIOMA[idioma];
    const exato = frases.get(texto.trim());
    if (exato) return texto.replace(texto.trim(), exato);
    return [...frases.entries()]
        .sort(([a], [b]) => b.length - a.length)
        .reduce((resultado, [original, traduzido]) => resultado.split(original).join(traduzido), texto);
}

function devePreservarTexto(no) {
    const pai = no.parentElement;
    return Boolean(pai?.closest(
        ".nome-receita, .nome-despesa, .grafico-categoria-nome, .despesa-grupo-categoria, .orcamento-edicao legend, " +
        "#lista-categorias, #despesa-categoria"
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
    for (const atributo of ["aria-label", "title", "placeholder", "alt"]) {
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
            attributeFilter: ["aria-label", "title", "placeholder", "alt"]
        });
    }
}

export function formatarMoeda(valor, moeda = "BRL", idioma = "pt-BR") {
    const locale = LOCALES[idioma] || LOCALES["pt-BR"];
    const currency = MOEDAS.includes(moeda) ? moeda : "BRL";
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(valor);
}

export { IDIOMAS, LOCALES, MOEDAS, textoTraduzido };
