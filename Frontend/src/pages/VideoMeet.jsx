import React, { useEffect, useMemo, useRef, useState } from 'react'
import io from "socket.io-client";
import { Badge, IconButton, TextField } from '@mui/material';
import { Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import styles from "../styles/videoComponent.module.css";
import CallEndIcon from '@mui/icons-material/CallEnd'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import ChatIcon from '@mui/icons-material/Chat'
import { useParams } from 'react-router-dom';
import server from '../environment';

const server_url = server;

var connections = {};

const rawTurnUrls = (
    process.env.REACT_APP_TURN_URLS ||
    process.env.REACT_APP_TURN_URL ||
    ""
)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

const envTurnUrls = (() => {
    // If user provides one TURN url like `turn:xxx:3478`, auto-add safe HTTPS-friendly fallbacks.
    if (rawTurnUrls.length !== 1) return rawTurnUrls;
    const single = rawTurnUrls[0];
    try {
        // Extract host from `turn:` / `turns:` urls.
        // Examples:
        // - turn:example.com:3478
        // - turns:example.com:5349
        const withoutProto = single.replace(/^turns?:/i, "");
        const host = withoutProto.split("?")[0].split(":")[0];
        if (!host) return rawTurnUrls;
        const fallbacks = [
            single,
            `turn:${host}:80?transport=tcp`,
            `turn:${host}:443?transport=tcp`,
            `turns:${host}:443?transport=tcp`,
        ];
        return Array.from(new Set(fallbacks));
    } catch (e) {
        return rawTurnUrls;
    }
})();

const envTurnUsername = process.env.REACT_APP_TURN_USERNAME;
const envTurnCredential =
    process.env.REACT_APP_TURN_CREDENTIAL ||
    process.env.REACT_APP_TURN_PASSWORD;

const peerConfigConnections = {
    iceCandidatePoolSize: 10,
    ...(envTurnUrls.length && envTurnUsername && envTurnCredential && process.env.NODE_ENV === "production"
        ? { iceTransportPolicy: "relay" }
        : {}),
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        ...(envTurnUrls.length && envTurnUsername && envTurnCredential
            ? [{
                urls: envTurnUrls,
                username: envTurnUsername,
                credential: envTurnCredential
            }]
            : [])
    ]
}

export default function VideoMeetComponent() {

    var socketRef = useRef();
    let socketIdRef = useRef();

    let localVideoref = useRef();

    let [videoAvailable, setVideoAvailable] = useState(true);

    let [audioAvailable, setAudioAvailable] = useState(true);

    let [video, setVideo] = useState([]);

    let [audio, setAudio] = useState();

    let [screen, setScreen] = useState();

    let [showModal, setModal] = useState(true);

    let [screenAvailable, setScreenAvailable] = useState();

    let [messages, setMessages] = useState([])

    let [message, setMessage] = useState("");

    let [newMessages, setNewMessages] = useState(3);

    let [askForUsername, setAskForUsername] = useState(true);

    let [username, setUsername] = useState("");

    const videoRef = useRef([])

    let [videos, setVideos] = useState([])

    const { url: roomIdParam } = useParams();
    const roomId = useMemo(() => {
        // Keep room keys stable across devices (don’t include protocol/host)
        return (roomIdParam || window.location.pathname || "").replace(/^\//, "");
    }, [roomIdParam]);

    const chatEndRef = useRef(null);

    const upsertRemoteStream = (socketListId, stream) => {
        if (!stream) return;
        let videoExists = videoRef.current.find(v => v.socketId === socketListId);
        if (videoExists) {
            setVideos(prev => {
                const updated = prev.map(v => v.socketId === socketListId ? { ...v, stream } : v);
                videoRef.current = updated;
                return updated;
            });
            return;
        }
        const newVideo = { socketId: socketListId, stream };
        setVideos(prev => {
            const updated = [...prev, newVideo];
            videoRef.current = updated;
            return updated;
        });
    };

    const attachLocalStreamToPc = (pc) => {
        if (!pc) return;
        if (window.localStream === undefined || window.localStream === null) {
            let blackSilence = (...args) => new MediaStream([black(...args), silence()]);
            window.localStream = blackSilence();
        }

        // Prefer modern addTrack/ontrack, fall back to addStream
        if (pc.addTrack && window.localStream.getTracks) {
            const senders = pc.getSenders ? pc.getSenders() : [];
            const existingTrackIds = new Set(senders.map(s => s.track?.id).filter(Boolean));
            window.localStream.getTracks().forEach(track => {
                if (!existingTrackIds.has(track.id)) {
                    pc.addTrack(track, window.localStream);
                }
            });
        } else if (pc.addStream) {
            pc.addStream(window.localStream);
        }
    };

    const ensurePeerConnection = (socketListId) => {
        if (!socketListId || socketListId === socketIdRef.current) return null;
        if (connections[socketListId]) return connections[socketListId];

        const pc = new RTCPeerConnection(peerConfigConnections);
        connections[socketListId] = pc;

        pc.oniceconnectionstatechange = () => {
            console.log("[webrtc] iceConnectionState", socketListId, pc.iceConnectionState);
        };
        pc.onconnectionstatechange = () => {
            console.log("[webrtc] connectionState", socketListId, pc.connectionState);
        };

        pc.onicecandidate = function (event) {
            if (event.candidate != null) {
                socketRef.current.emit('signal', socketListId, JSON.stringify({ 'ice': event.candidate }));
            }
        };

        // Remote media (modern)
        pc.ontrack = (event) => {
            const stream = event.streams?.[0];
            upsertRemoteStream(socketListId, stream);
        };

        // Remote media (legacy fallback)
        pc.onaddstream = (event) => {
            upsertRemoteStream(socketListId, event.stream);
        };

        attachLocalStreamToPc(pc);
        return pc;
    };

    // TODO
    // if(isChrome() === false) {


    // }

    useEffect(() => {
        getPermissions();
    }, [])

    let getDislayMedia = () => {
        if (screen) {
            if (navigator.mediaDevices.getDisplayMedia) {
                navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
                    .then(getDislayMediaSuccess)
                    .then((stream) => { })
                    .catch((e) => console.log(e))
            }
        }
    }

    const getPermissions = async () => {
        try {
            const videoPermission = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoPermission) {
                setVideoAvailable(true);
                console.log('Video permission granted');
            } else {
                setVideoAvailable(false);
                console.log('Video permission denied');
            }

            const audioPermission = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (audioPermission) {
                setAudioAvailable(true);
                console.log('Audio permission granted');
            } else {
                setAudioAvailable(false);
                console.log('Audio permission denied');
            }

            if (navigator.mediaDevices.getDisplayMedia) {
                setScreenAvailable(true);
            } else {
                setScreenAvailable(false);
            }

            if (videoAvailable || audioAvailable) {
                const userMediaStream = await navigator.mediaDevices.getUserMedia({ video: videoAvailable, audio: audioAvailable });
                if (userMediaStream) {
                    window.localStream = userMediaStream;
                    if (localVideoref.current) {
                        localVideoref.current.srcObject = userMediaStream;
                    }
                }
            }
        } catch (error) {
            console.log(error);
        }
    };

    useEffect(() => {
        if (video !== undefined && audio !== undefined) {
            getUserMedia();
            console.log("SET STATE HAS ", video, audio);

        }


    }, [video, audio])
    let getMedia = () => {
        setVideo(videoAvailable);
        setAudio(audioAvailable);
        connectToSocketServer();

    }




    let getUserMediaSuccess = (stream) => {
        try {
            window.localStream.getTracks().forEach(track => track.stop())
        } catch (e) { console.log(e) }

        window.localStream = stream
        localVideoref.current.srcObject = stream

        for (let id in connections) {
            if (id === socketIdRef.current) continue

            connections[id].addStream(window.localStream)

            connections[id].createOffer().then((description) => {
                console.log(description)
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                    })
                    .catch(e => console.log(e))
            })
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setVideo(false);
            setAudio(false);

            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { console.log(e) }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()])
            window.localStream = blackSilence()
            localVideoref.current.srcObject = window.localStream

            for (let id in connections) {
                connections[id].addStream(window.localStream)

                connections[id].createOffer().then((description) => {
                    connections[id].setLocalDescription(description)
                        .then(() => {
                            socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                        })
                        .catch(e => console.log(e))
                })
            }
        })
    }

    let getUserMedia = () => {
        if ((video && videoAvailable) || (audio && audioAvailable)) {
            navigator.mediaDevices.getUserMedia({ video: video, audio: audio })
                .then(getUserMediaSuccess)
                .then((stream) => { })
                .catch((e) => console.log(e))
        } else {
            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { }
        }
    }





    let getDislayMediaSuccess = (stream) => {
        console.log("HERE")
        try {
            window.localStream.getTracks().forEach(track => track.stop())
        } catch (e) { console.log(e) }

        window.localStream = stream
        localVideoref.current.srcObject = stream

        for (let id in connections) {
            if (id === socketIdRef.current) continue

            connections[id].addStream(window.localStream)

            connections[id].createOffer().then((description) => {
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                    })
                    .catch(e => console.log(e))
            })
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setScreen(false)

            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { console.log(e) }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()])
            window.localStream = blackSilence()
            localVideoref.current.srcObject = window.localStream

            getUserMedia()

        })
    }

    let gotMessageFromServer = async (fromId, message) => {
        const signal = JSON.parse(message)

        if (fromId === socketIdRef.current) return;

        const pc = ensurePeerConnection(fromId);
        if (!pc) return;

        try {
            if (signal.sdp) {
                const desc = new RTCSessionDescription(signal.sdp);

                // Glare handling: if we get an offer while not stable, rollback local offer first.
                if (desc.type === "offer" && pc.signalingState !== "stable") {
                    try {
                        await pc.setLocalDescription({ type: "rollback" });
                    } catch (e) {
                        // If rollback isn't supported, ignore this offer to avoid "wrong state" errors.
                        console.log("[webrtc] rollback failed, ignoring offer", fromId, pc.signalingState, e);
                        return;
                    }
                }

                // If we get an answer but we never made an offer, ignore.
                if (desc.type === "answer" && pc.signalingState === "stable") {
                    console.log("[webrtc] ignoring unexpected answer (stable)", fromId);
                    return;
                }

                await pc.setRemoteDescription(desc);

                if (desc.type === 'offer') {
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    socketRef.current.emit('signal', fromId, JSON.stringify({ 'sdp': pc.localDescription }))
                }
            }

            if (signal.ice) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(signal.ice));
                } catch (e) {
                    console.log("[webrtc] addIceCandidate failed", fromId, e);
                }
            }
        } catch (e) {
            console.log("[webrtc] signal handling failed", fromId, e);
        }
    }




    let connectToSocketServer = () => {
        // Let socket.io pick ws/wss correctly based on URL
        socketRef.current = io(server_url, {
            transports: ["websocket", "polling"],
        })

        socketRef.current.on('signal', gotMessageFromServer)

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-call', roomId)
            socketIdRef.current = socketRef.current.id

            socketRef.current.on('chat-message', addMessage)

            socketRef.current.on('user-left', (id) => {
                setVideos((videos) => videos.filter((video) => video.socketId !== id))
                try {
                    connections[id]?.close?.();
                } catch (e) { }
                delete connections[id];
            })

            socketRef.current.on('user-joined', (id, clients) => {
                clients.forEach((socketListId) => {
                    ensurePeerConnection(socketListId);
                })

                if (id === socketIdRef.current) {
                    for (let id2 in connections) {
                        if (id2 === socketIdRef.current) continue

                        try {
                            attachLocalStreamToPc(connections[id2]);
                        } catch (e) { }

                        connections[id2].createOffer().then((description) => {
                            connections[id2].setLocalDescription(description)
                                .then(() => {
                                    socketRef.current.emit('signal', id2, JSON.stringify({ 'sdp': connections[id2].localDescription }))
                                })
                                .catch(e => console.log(e))
                        })
                    }
                }
            })
        })
    }

    let silence = () => {
        let ctx = new AudioContext()
        let oscillator = ctx.createOscillator()
        let dst = oscillator.connect(ctx.createMediaStreamDestination())
        oscillator.start()
        ctx.resume()
        return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false })
    }
    let black = ({ width = 640, height = 480 } = {}) => {
        let canvas = Object.assign(document.createElement("canvas"), { width, height })
        canvas.getContext('2d').fillRect(0, 0, width, height)
        let stream = canvas.captureStream()
        return Object.assign(stream.getVideoTracks()[0], { enabled: false })
    }

    let handleVideo = () => {
        setVideo(!video);
        // getUserMedia();
    }
    let handleAudio = () => {
        setAudio(!audio)
        // getUserMedia();
    }

    useEffect(() => {
        if (screen !== undefined) {
            getDislayMedia();
        }
    }, [screen])
    let handleScreen = () => {
        setScreen(!screen);
    }

    let handleEndCall = () => {
        try {
            let tracks = localVideoref.current.srcObject.getTracks()
            tracks.forEach(track => track.stop())
        } catch (e) { }
        window.location.href = "/"
    }

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((prevNewMessages) => prevNewMessages + 1);
        }
    };

    useEffect(() => {
        // Keep chat scrolled to latest message
        chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages, showModal]);



    let sendMessage = () => {
        console.log(socketRef.current);
        socketRef.current.emit('chat-message', message, username)
        setMessage("");

        // this.setState({ message: "", sender: username })
    }

    
    let connect = () => {
        setAskForUsername(false);
        getMedia();
    }


    return (
        <div>

            {askForUsername === true ?

                <div>


                    <h2>Enter into Lobby </h2>
                    <TextField id="outlined-basic" label="Username" value={username} onChange={e => setUsername(e.target.value)} variant="outlined" />
                    <Button variant="contained" onClick={connect}>Connect</Button>


                    <div>
                        <video
                            ref={localVideoref}
                            autoPlay
                            muted
                            playsInline
                            onLoadedMetadata={(e) => e.currentTarget.play?.().catch(() => { })}
                        ></video>
                    </div>

                </div> :


                <div className={styles.meetVideoContainer}>

                    {showModal ? <div className={styles.chatRoom}>

                        <div className={styles.chatContainer}>
                            <h1>Chat</h1>

                            <div className={styles.chattingDisplay}>

                                {messages.length !== 0 ? messages.map((item, index) => {

                                    console.log(messages)
                                    return (
                                        <div style={{ marginBottom: "20px" }} key={index}>
                                            <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                                            <p>{item.data}</p>
                                        </div>
                                    )
                                }) : <p>No Messages Yet</p>}

                                <div ref={chatEndRef} />


                            </div>

                            <div className={styles.chattingArea}>
                                <TextField value={message} onChange={(e) => setMessage(e.target.value)} id="outlined-basic" label="Enter Your chat" variant="outlined" />
                                <Button variant='contained' onClick={sendMessage}>Send</Button>
                            </div>


                        </div>
                    </div> : <></>}


                    <div className={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: "white" }}>
                            {(video === true) ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>
                        <IconButton onClick={handleEndCall} style={{ color: "red" }}>
                            <CallEndIcon  />
                        </IconButton>
                        <IconButton onClick={handleAudio} style={{ color: "white" }}>
                            {audio === true ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>

                        {screenAvailable === true ?
                            <IconButton onClick={handleScreen} style={{ color: "white" }}>
                                {screen === true ? <ScreenShareIcon /> : <StopScreenShareIcon />}
                            </IconButton> : <></>}

                        <Badge badgeContent={newMessages} max={999} color='orange'>
                            <IconButton onClick={() => setModal(!showModal)} style={{ color: "white" }}>
                                <ChatIcon />                        </IconButton>
                        </Badge>

                    </div>


                    <video
                        className={styles.meetUserVideo}
                        ref={localVideoref}
                        autoPlay
                        muted
                        playsInline
                        onLoadedMetadata={(e) => e.currentTarget.play?.().catch(() => { })}
                    ></video>

                    <div className={styles.conferenceView}>
                        {videos.map((video) => (
                            <div className={styles.conferenceTile} key={video.socketId}>
                                <video

                                    data-socket={video.socketId}
                                    ref={ref => {
                                        if (ref && video.stream) {
                                            ref.srcObject = video.stream;
                                            ref.play?.().catch(() => { });
                                        }
                                    }}
                                    autoPlay
                                    playsInline
                                    onLoadedMetadata={(e) => e.currentTarget.play?.().catch(() => { })}
                                >
                                </video>
                            </div>

                        ))}

                    </div>

                </div>

            }

        </div>
    )
}
