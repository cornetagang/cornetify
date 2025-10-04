// ===================================================================
// CONFIGURACIÓN CLAVE (¡REEMPLAZA EL TOKEN!)
// ===================================================================
// Este token solo dura 1 hora. Necesitarás generar uno nuevo o implementar
// el flujo de autenticación completo para que sea permanente.
const SPOTIFY_ACCESS_TOKEN = 'TU_TOKEN_PEGADO_AQUÍ'; 

const SPOTIFY_BASE_URL = 'https://api.spotify.com/';
const AUDIUS_BASE_URL = 'https://discoveryprovider.audius.co/v1';
const APP_NAME = 'MiReproductorHibridoPersonal'; 

// ===================================================================
// VARIABLES DEL DOM
// ===================================================================
const spotifyUrlInput = document.getElementById('spotify-url-input');
const loadPlaylistBtn = document.getElementById('load-playlist-btn');
const playlistPreview = document.getElementById('playlist-preview');
const audioPlayer = document.getElementById('audio-player');
const songTitleDisplay = document.getElementById('song-title');

// ===================================================================
// GESTIÓN DE LA COLA
// ===================================================================
let currentPlaylist = []; // La lista de metadatos de Spotify
let currentTrackIndex = 0; 


// ===================================================================
// 1. UTILIDAD SPOTIFY: Fetch Genérico (Basado en tu código)
// ===================================================================

async function fetchWebApi(endpoint, method, body) {
    if (!SPOTIFY_ACCESS_TOKEN || SPOTIFY_ACCESS_TOKEN === 'TU_TOKEN_PEGADO_AQUÍ') {
        throw new Error("ERROR: Token de Spotify no configurado o es el valor por defecto.");
    }

    const res = await fetch(`${SPOTIFY_BASE_URL}${endpoint}`, {
        headers: {
            Authorization: `Bearer ${SPOTIFY_ACCESS_TOKEN}`,
        },
        method,
        body: JSON.stringify(body)
    });
    return await res.json();
}

// ===================================================================
// 2. OBTENER PLAYLIST DE SPOTIFY (Metadatos)
// ===================================================================

// Función para obtener todas las pistas de una playlist dada (maneja paginación)
async function getPlaylistTracks(playlistId) {
    let tracks = [];
    let offset = 0;
    let total = 1; // Inicializamos para entrar en el bucle

    while (tracks.length < total) {
        // La API de Spotify limita a 100 tracks por petición
        const data = await fetchWebApi(
            `v1/playlists/${playlistId}/tracks?offset=${offset}&limit=100`, 'GET'
        );
        
        if (data.error) {
             throw new Error(`Error en API de Spotify: ${data.error.message}`);
        }

        total = data.total;
        
        // Filtramos y mapeamos solo la información que necesitamos para la búsqueda limpia
        const mappedTracks = data.items
            .filter(item => item.track)
            .map(item => ({
                title: item.track.name,
                artist: item.track.artists.map(a => a.name).join(', '),
                // Query optimizada para buscar en Audius
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
    audioPlayer.pause(); // Pausar mientras buscamos

    try {
        // Búsqueda en Audius usando la query de Spotify
        const response = await fetch(`${AUDIUS_BASE_URL}/tracks/search?query=${encodeURIComponent(track.search_query)}&app_name=${APP_NAME}`);
        const tracksData = await response.json();
        const bestMatch = tracksData.data ? tracksData.data[0] : null; 
        
        if (bestMatch) {
            // Reproducir el audio SIN ANUNCIOS de Audius
            const streamUrl = `${AUDIUS_BASE_URL}/tracks/${bestMatch.id}/stream?app_name=${APP_NAME}`;
            audioPlayer.src = streamUrl;
            audioPlayer.play();
            songTitleDisplay.textContent = `▶️ ${track.title} - ${track.artist} (Clean Stream)`;
        } else {
            // Si Audius no tiene el match, saltamos
            songTitleDisplay.textContent = `🚫 No se encontró audio limpio para: ${track.title}. Saltando.`;
            playNextTrack();
        }
    } catch (error) {
        console.error("Error en la búsqueda limpia o reproducción:", error);
        playNextTrack(); // Saltar si hay un error crítico
    }
}

// ===================================================================
// 4. LÓGICA DE CONTROL DEL REPRODUCTOR
// ===================================================================

// Gestiona la carga de la playlist completa
async function loadPlaylistFromUrl() {
    const url = spotifyUrlInput.value.trim();
    
    // Extraer el ID de la Playlist de la URL
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
            currentTrackIndex = -1; // Prepara para el primer track
            playNextTrack(); // Inicia la reproducción
        } else {
            playlistPreview.innerHTML = '<p>La playlist está vacía o hubo un error al cargar.</p>';
        }

    } catch (error) {
        console.error("Error general:", error.message);
        playlistPreview.innerHTML = `<p>Error al cargar: ${error.message}. Verifica tu Token.</p>`;
    }
}

// Avanza a la siguiente canción en la cola
function playNextTrack() {
    currentTrackIndex++;
    if (currentTrackIndex < currentPlaylist.length) {
        startHybridPlayback(currentPlaylist[currentTrackIndex]);
    } else {
        songTitleDisplay.textContent = "Playlist terminada. ¡A dormir! 😴";
        audioPlayer.pause();
        currentTrackIndex = -1; // Reiniciar
    }
}

// Muestra la lista de canciones cargadas de Spotify
function displayPlaylistPreview() {
    playlistPreview.innerHTML = '<h3>Contenido de la Playlist:</h3>';
    currentPlaylist.forEach((track, index) => {
        const item = document.createElement('p');
        item.textContent = `${index + 1}. ${track.title} - ${track.artist}`;
        playlistPreview.appendChild(item);
    });
}

// ===================================================================
// EVENT LISTENERS
// ===================================================================

// Carga la playlist cuando se pulsa el botón
loadPlaylistBtn.addEventListener('click', loadPlaylistFromUrl);

// Avanza a la siguiente canción cuando la actual termina
audioPlayer.addEventListener('ended', playNextTrack);