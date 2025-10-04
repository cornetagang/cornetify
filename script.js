// ===================================================================
// CONFIGURACIÓN DE LA APLICACIÓN
// ===================================================================
const CLIENT_ID = '7371745b604943eb969dee9b8eb99668'; 
const REDIRECT_URI = 'https://cornetagang.github.io/cornetify/';
const SPOTIFY_BASE_URL = 'https://api.spotify.com/';
const APP_NAME = 'MiReproductorHibridoPersonal'; 

// NECESITAS TU API KEY DE YOUTUBE DATA API V3
const YOUTUBE_API_KEY = "AIzaSyCBy13MoZmXAbjS8SEEIXhtNltjPjTxM_g"; 

// ===================================================================
// VARIABLES DEL DOM Y ESTADO
// ===================================================================
const spotifyUrlInput = document.getElementById('spotify-url-input');
const loadPlaylistBtn = document.getElementById('load-playlist-btn');
const playlistPreview = document.getElementById('playlist-preview');
const songTitleDisplay = document.getElementById('song-title');

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const appContent = document.getElementById('app-content');

const prevBtn = document.getElementById('prev-btn');
const playBtn = document.getElementById('play-btn');
const nextBtn = document.getElementById('next-btn');

let currentPlaylist = [];
let currentTrackIndex = 0;
let ytPlayer; // YouTube Player

// ===================================================================
// AUTENTICACIÓN SPOTIFY (PKCE)
// ===================================================================
let accessToken = localStorage.getItem('spotify_access_token');
let refreshToken = localStorage.getItem('spotify_refresh_token');

function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length }, () => possible.charAt(Math.floor(Math.random() * possible.length))).join('');
}

async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

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
}

function spotifyLogout() {
    localStorage.clear();
    accessToken = null;
    refreshToken = null;
    currentPlaylist = [];
    currentTrackIndex = 0;
    if (ytPlayer) ytPlayer.stopVideo();
    songTitleDisplay.textContent = 'Esperando playlist...';
    playlistPreview.innerHTML = '';
    updateUI(false);
}

function updateUI(isLoggedIn) {
    loginBtn.style.display = isLoggedIn ? 'none' : 'block';
    logoutBtn.style.display = isLoggedIn ? 'block' : 'none';
    appContent.style.display = isLoggedIn ? 'block' : 'none';
    songTitleDisplay.textContent = isLoggedIn ? 'Conectado a Spotify. Pega un enlace.' : 'Esperando conexión...';
}

// ===================================================================
// FETCH SPOTIFY API
// ===================================================================
async function fetchWebApi(endpoint, method, body) {
    if (!accessToken) throw new Error("No autorizado");

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

    return res.json();
}

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
        .filter(item => item.track && item.track.name && item.track.artists)
        .map(item => ({
            title: item.track.name,
            artist: item.track.artists?.map(a => a.name).join(', ') || "Desconocido",
            search_query: `${item.track.name} ${item.track.artists?.[0]?.name || ""}`
        }));
        tracks.push(...mappedTracks);
        offset += data.items.length;
    }
    return tracks;
}

// ===================================================================
// YOUTUBE PLAYER
// ===================================================================
function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player('youtube-player', {
        height: '200',
        width: '350',
        events: {
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
        playNextTrack();
    }
}

async function startYouTubePlayback(track) {
    songTitleDisplay.textContent = `🔎 Buscando en YouTube: ${track.title} - ${track.artist}`;
    try {
        const query = encodeURIComponent(track.search_query);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${query}&key=${YOUTUBE_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        const videoId = data.items[0]?.id?.videoId;
        if (videoId) {
            ytPlayer.loadVideoById(videoId);
            songTitleDisplay.textContent = `▶️ ${track.title} - ${track.artist}`;
        } else {
            songTitleDisplay.textContent = `🚫 No se encontró en YouTube: ${track.title}`;
            playNextTrack();
        }
    } catch (err) {
        console.error("Error YouTube:", err);
        playNextTrack();
    }
}

// ===================================================================
// CONTROL DEL REPRODUCTOR
// ===================================================================
async function loadPlaylistFromUrl() {
    const url = spotifyUrlInput.value.trim();
    const playlistMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
    if (!playlistMatch) return alert("URL de Playlist inválida.");

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
        playlistPreview.innerHTML = `<p>Error al cargar: ${error.message}. ¿Sesión caducada?</p>`;
    }
}

function playNextTrack() {
    currentTrackIndex++;
    if (currentTrackIndex < currentPlaylist.length) {
        startYouTubePlayback(currentPlaylist[currentTrackIndex]);
    } else {
        songTitleDisplay.textContent = "Playlist terminada. 😴";
        currentTrackIndex = -1;
    }
}

function playPrevTrack() {
    currentTrackIndex--;
    if (currentTrackIndex >= 0) {
        startYouTubePlayback(currentPlaylist[currentTrackIndex]);
    } else {
        songTitleDisplay.textContent = "Estás al inicio de la playlist.";
        currentTrackIndex = 0;
    }
}

function togglePlayPause() {
    if (ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        ytPlayer.pauseVideo();
    } else {
        ytPlayer.playVideo();
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
prevBtn.addEventListener('click', playPrevTrack);
playBtn.addEventListener('click', togglePlayPause);
nextBtn.addEventListener('click', playNextTrack);
