// ===================================================================
// CONFIGURACIÓN DE LA APLICACIÓN (¡REEMPLAZA ESTOS VALORES!)
// ===================================================================
// CLIENT_ID obtenido de tu imagen
const CLIENT_ID = '73f7f745b604943ab969dee9b8eb99668'; 

// Esta debe ser la URL que configuraste en tu App de Spotify (generalmente localhost)
// IMPORTANTE: Debe coincidir exactamente con la configurada en el Dashboard de Spotify.
const REDIRECT_URI = 'https://cornetagang.github.io/cornetify/'; // Ejemplo para Live Server de VS Code

const SPOTIFY_BASE_URL = 'https://api.spotify.com/';
const AUDIUS_BASE_URL = 'https://discoveryprovider.audius.co/v1';
const APP_NAME = 'MiReproductorHibridoPersonal'; 


// ===================================================================
// VARIABLES DEL DOM Y ESTADO
// ===================================================================
const spotifyUrlInput = document.getElementById('spotify-url-input');
const loadPlaylistBtn = document.getElementById('load-playlist-btn');
const playlistPreview = document.getElementById('playlist-preview');
const audioPlayer = document.getElementById('audio-player');
const songTitleDisplay = document.getElementById('song-title');

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const appContent = document.getElementById('app-content');

let currentPlaylist = [];
let currentTrackIndex = 0;


// ===================================================================
// MÓDULO DE AUTENTICACIÓN PKCE (PERSISTENCIA DE TOKEN)
// ===================================================================

// Guarda el token en localStorage para usarlo en futuras sesiones
let accessToken = localStorage.getItem('spotify_access_token');
let refreshToken = localStorage.getItem('spotify_refresh_token');

// Helper para generar una cadena aleatoria
function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// Helper para codificar el code_verifier
async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

// Inicia el flujo de autenticación (redirige a Spotify)
async function spotifyLogin() {
    const codeVerifier = generateRandomString(128);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    localStorage.setItem('code_verifier', codeVerifier);

    const scope = 'playlist-read-private user-read-private'; // Permisos necesarios
    const authUrl = new URL("https://developer.spotify.com/documentation/web-api0");

    const params = {
        response_type: 'code',
        client_id: CLIENT_ID,
        scope,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        redirect_uri: REDIRECT_URI,
    };

    authUrl.search = new URLSearchParams(params).toString();
    window.location.href = authUrl.toString();
}

// Intercambia el código por el token de acceso
async function getAccessToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier');

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
    });

    const response = await fetch('https://developer.spotify.com/documentation/web-api1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });

    const data = await response.json();
    
    // Almacenar tokens
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    localStorage.setItem('spotify_access_token', accessToken);
    localStorage.setItem('spotify_refresh_token', refreshToken);
    
    updateUI(true);
}

// Refresca el token cuando caduca
async function refreshAccessToken() {
    if (!refreshToken) return;
    
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    });

    const response = await fetch('https://developer.spotify.com/documentation/web-api1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });
    
    const data = await response.json();
    
    accessToken = data.access_token;
    localStorage.setItem('spotify_access_token', accessToken);
    
    console.log("Token de Spotify refrescado con éxito.");
}

// Limpia el almacenamiento y desloguea
function spotifyLogout() {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('code_verifier');
    accessToken = null;
    refreshToken = null;
    currentPlaylist = [];
    currentTrackIndex = 0;
    audioPlayer.pause();
    songTitleDisplay.textContent = 'Esperando playlist...';
    playlistPreview.innerHTML = '';
    updateUI(false);
}

// Actualiza la interfaz de usuario (ocultar/mostrar botones)
function updateUI(isLoggedIn) {
    if (isLoggedIn) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
        appContent.style.display = 'block';
        songTitleDisplay.textContent = 'Conectado a Spotify. Pega un enlace.';
    } else {
        loginBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
        appContent.style.display = 'none';
        songTitleDisplay.textContent = 'Esperando conexión...';
    }
}


// ===================================================================
// 1. UTILIDAD SPOTIFY: Fetch Genérico (Usa el token persistente)
// ===================================================================

async function fetchWebApi(endpoint, method, body) {
    if (!accessToken) {
        alert("Tu sesión de Spotify expiró. Por favor, inicia sesión de nuevo.");
        updateUI(false);
        throw new Error("Acceso no autorizado.");
    }
    
    let res = await fetch(`${SPOTIFY_BASE_URL}${endpoint}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        method,
        body: JSON.stringify(body)
    });

    // Si el token falló, intentamos refrescarlo y reintentamos la petición
    if (res.status === 401) {
        await refreshAccessToken();
        res = await fetch(`${SPOTIFY_BASE_URL}${endpoint}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            method,
            body: JSON.stringify(body)
        });
    }

    const data = await res.json();
    if (data.error) {
         throw new Error(`Error en API de Spotify: ${data.error.message}`);
    }
    return data;
}

// ===================================================================
// 2. OBTENER PLAYLIST DE SPOTIFY (Metadatos)
// ===================================================================

async function getPlaylistTracks(playlistId) {
    // Implementación idéntica a la del paso anterior (paginación)
    let tracks = [];
    let offset = 0;
    let total = 1;

    while (tracks.length < total) {
        const data = await fetchWebApi(
            `v1/playlists/${playlistId}/tracks?offset=${offset}&limit=100`, 'GET'
        );
        
        total = data.total;
        
        const mappedTracks = data.items
            .filter(item => item.track && item.track.album) // Filtro adicional de validez
            .map(item => ({
                title: item.track.name,
                artist: item.track.artists.map(a => a.name).join(', '),
                search_query: `${item.track.name} ${item.track.artists[0].name}` 
            }));

        tracks.push(...mappedTracks);
        offset += data.items.length;
    }
    
    return tracks;
}

// ===================================================================
// 3. REPRODUCCIÓN HÍBRIDA (Búsqueda Limpia en Audius)
// ===================================================================

async function startHybridPlayback(track) {
    songTitleDisplay.textContent = `Buscando audio limpio: ${track.title} - ${track.artist}`;
    audioPlayer.pause(); 

    try {
        const response = await fetch(`${AUDIUS_BASE_URL}/tracks/search?query=${encodeURIComponent(track.search_query)}&app_name=${APP_NAME}`);
        const tracksData = await response.json();
        const bestMatch = tracksData.data ? tracksData.data[0] : null; 
        
        if (bestMatch) {
            const streamUrl = `${AUDIUS_BASE_URL}/tracks/${bestMatch.id}/stream?app_name=${APP_NAME}`;
            audioPlayer.src = streamUrl;
            audioPlayer.play();
            songTitleDisplay.textContent = `▶️ ${track.title} - ${track.artist} (Clean Stream)`;
        } else {
            songTitleDisplay.textContent = `🚫 No se encontró audio limpio para: ${track.title}. Saltando.`;
            playNextTrack();
        }
    } catch (error) {
        console.error("Error en la búsqueda limpia o reproducción:", error);
        playNextTrack(); 
    }
}

// ===================================================================
// 4. LÓGICA DE CONTROL DEL REPRODUCTOR
// ===================================================================

async function loadPlaylistFromUrl() {
    const url = spotifyUrlInput.value.trim();
    const playlistMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
    
    if (!playlistMatch) {
        alert("URL de Playlist inválida.");
        return;
    }
    const playlistId = playlistMatch[1];
    playlistPreview.innerHTML = 'Cargando playlist de Spotify...';

    try {
        currentPlaylist = await getPlaylistTracks(playlistId);
        
        if (currentPlaylist.length > 0) {
            displayPlaylistPreview();
            currentTrackIndex = -1;
            playNextTrack(); 
        } else {
            playlistPreview.innerHTML = '<p>La playlist está vacía o es privada.</p>';
        }

    } catch (error) {
        console.error("Error general:", error.message);
        playlistPreview.innerHTML = `<p>Error al cargar: ${error.message}. ¿Sesión caducada?</p>`;
    }
}

function playNextTrack() {
    currentTrackIndex++;
    if (currentTrackIndex < currentPlaylist.length) {
        startHybridPlayback(currentPlaylist[currentTrackIndex]);
    } else {
        songTitleDisplay.textContent = "Playlist terminada. ¡A dormir! 😴";
        audioPlayer.pause();
        currentTrackIndex = -1;
    }
}

function displayPlaylistPreview() {
    playlistPreview.innerHTML = '<h3>Contenido de la Playlist:</h3>';
    currentPlaylist.forEach((track, index) => {
        const item = document.createElement('p');
        item.textContent = `${index + 1}. ${track.title} - ${track.artist}`;
        playlistPreview.appendChild(item);
    });
}


// ===================================================================
// INICIALIZACIÓN Y EVENT LISTENERS
// ===================================================================

// Maneja la redirección después del login de Spotify
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        // Si hay un código, es la respuesta de Spotify, ¡intercambiamos por el token!
        getAccessToken(code);
        
        // Limpiamos el código de la URL para evitar errores al refrescar
        history.replaceState(null, null, window.location.pathname);
    } else if (accessToken) {
        // Si ya tenemos un token, mostramos la app directamente
        updateUI(true);
    } else {
        // Si no hay código ni token, mostramos el botón de login
        updateUI(false);
    }
};

// Autenticación
loginBtn.addEventListener('click', spotifyLogin);
logoutBtn.addEventListener('click', spotifyLogout);

// Funcionalidad del reproductor
loadPlaylistBtn.addEventListener('click', loadPlaylistFromUrl);
audioPlayer.addEventListener('ended', playNextTrack);
