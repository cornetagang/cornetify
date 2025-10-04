// ===================================================================
// CONFIGURACIÓN DE LA APLICACIÓN
// ===================================================================
// CLIENT_ID obtenido de tu app en el dashboard de Spotify
const CLIENT_ID = '7371745b604943eb969dee9b8eb99668'; 

// Debe coincidir EXACTAMENTE con la redirect URI registrada en Spotify
const REDIRECT_URI = 'https://cornetagang.github.io/cornetify/';

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

let accessToken = localStorage.getItem('spotify_access_token');
let refreshToken = localStorage.getItem('spotify_refresh_token');

function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

// Inicia el flujo de autenticación
async function spotifyLogin() {
    const codeVerifier = generateRandomString(128);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    localStorage.setItem('code_verifier', codeVerifier);

    const scope = 'playlist-read-private user-read-private';
    const authUrl = new URL("https://accounts.spotify.com/authorize");

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

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });

    const data = await response.json();
    
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

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });
    
    const data = await response.json();
    
    accessToken = data.access_token;
    localStorage.setItem('spotify_access_token', accessToken);
    
    console.log("Token de Spotify refrescado con éxito.");
}

// Limpia sesión
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

// Actualiza UI
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
// 1. Fetch genérico Spotify
// ===================================================================
async function fetchWebApi(endpoint, method, body) {
    if (!accessToken) {
        alert("Tu sesión de Spotify expiró. Por favor, inicia sesión de nuevo.");
        updateUI(false);
        throw new Error("Acceso no autorizado.");
    }
    
    let res = await fetch(`${SPOTIFY_BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        method,
        body: body ? JSON.stringify(body) : null
    });

    if (res.status === 401) {
        await refreshAccessToken();
        res = await fetch(`${SPOTIFY_BASE_URL}${endpoint}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            method,
            body: body ? JSON.stringify(body) : null
        });
    }

    const data = await res.json();
    if (data.error) throw new Error(`Error en API de Spotify: ${data.error.message}`);
    return data;
}


// ===================================================================
// 2. Obtener playlist de Spotify
// ===================================================================
async function getPlaylistTracks(playlistId) {
    let tracks = [];
    let offset = 0;
    let total = 1;

    while (tracks.length < total) {
        const data = await fetchWebApi(
            `v1/playlists/${playlistId}/tracks?offset=${offset}&limit=100`, 'GET'
        );
        
        total = data.total;
        
        const mappedTracks = data.items
            .filter(item => item.track && item.track.album)
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
// 3. Reproducción híbrida (Audius)
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
// 4. Control de reproductor
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
// Inicialización y listeners
// ===================================================================
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        getAccessToken(code);
        history.replaceState(null, null, window.location.pathname);
    } else if (accessToken) {
        updateUI(true);
    } else {
        updateUI(false);
    }
};

loginBtn.addEventListener('click', spotifyLogin);
logoutBtn.addEventListener('click', spotifyLogout);
loadPlaylistBtn.addEventListener('click', loadPlaylistFromUrl);
audioPlayer.addEventListener('ended', playNextTrack);

function playPrevTrack() {
    currentTrackIndex--;
    if (currentTrackIndex >= 0) {
        startHybridPlayback(currentPlaylist[currentTrackIndex]);
    } else {
        songTitleDisplay.textContent = "Estás al inicio de la playlist.";
        currentTrackIndex = 0;
    }
}

function togglePlayPause() {
    if (audioPlayer.paused) {
        audioPlayer.play();
    } else {
        audioPlayer.pause();
    }
}

const prevBtn = document.getElementById('prev-btn');
const playBtn = document.getElementById('play-btn');
const nextBtn = document.getElementById('next-btn');

prevBtn.addEventListener('click', playPrevTrack);
playBtn.addEventListener('click', togglePlayPause);
nextBtn.addEventListener('click', playNextTrack);
