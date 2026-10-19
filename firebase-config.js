// Configuração pública do Firebase Web.
// A segurança dos dados é garantida também pelas regras do Firestore.
export const firebaseConfig = Object.freeze({
    apiKey: "AIzaSyBbULVJ-Yw1IQTGNOqZthv3QARtfuTx1FU",
    authDomain: "controle-financeiro-pess-dddbd.firebaseapp.com",
    projectId: "controle-financeiro-pess-dddbd",
    appId: "1:1012664841926:web:51969c11d57cbd484949c7"
});

export function firebaseConfigurado(config = firebaseConfig) {
    return Object.values(config).every((value) => typeof value === "string"
        && value.length > 0 && !value.startsWith("CONFIGURE_"));
}