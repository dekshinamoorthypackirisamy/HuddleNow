import { useEffect, useRef, useState } from "react";
import {
  useNavigate,
  useLocation,
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import {
  Badge,
  Box,
  Button,
  CircularProgress,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import NotificationsNoneRoundedIcon from "@mui/icons-material/NotificationsNoneRounded";
import axios from "axios";
import SimplePeer from "simple-peer/simplepeer.min.js";
import { io } from "socket.io-client";
import useTimeTheme from "./hooks/useTimeTheme";
import { useUserActivityStats } from "./hooks/useUserActivityStats";

const PeerConstructor =
  typeof SimplePeer === "function" ? SimplePeer : SimplePeer?.default;

// Normalize Google profile photos to a higher resolution and safe URL for cross-origin
function getHighResGooglePhoto(url) {
  if (!url) return null;
  try {
    // Many Google photos include a size query like =s96-c or =s96. Replace with =s400-c for higher res.
    return url.replace(/=s\d+(-c)?/i, "=s400-c");
  } catch (e) {
    return url;
  }
}

// Avatar component: wraps an image in a circular container with mic-wave background.
function Avatar({
  src,
  alt,
  size = 50,
  micLevel = 0,
  className = "",
  style = {},
  children,
  ...props
}) {
  const finalSrc = src ? getHighResGooglePhoto(src) : null;
  const speaking = (micLevel || 0) > 0.06;
  const baseStyle = {
    width: size,
    height: size,
    "--mic-level": micLevel || 0,
    ...style,
  };
  return (
    <button
      type="button"
      className={`${className || ""} avatar-button ${speaking ? "speaking" : ""}`.trim()}
      style={baseStyle}
      {...props}
    >
      <span className="mic-wave" aria-hidden="true" />
      {finalSrc ? (
        <img
          src={finalSrc}
          alt={alt || "avatar"}
          referrerPolicy="no-referrer"
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <span>{children || (alt || "U").charAt(0)}</span>
      )}
    </button>
  );
}

function NoVideoTile({ participant, fallbackName = "Guest" }) {
  const displayName =
    participant?.displayName || participant?.email || fallbackName;
  const photo = participant?.avatar || participant?.picture;
  return (
    <div className="no-video-tile">
      <div className="no-video-avatar-wrap">
        {photo ? (
          <img src={photo} alt={displayName} referrerPolicy="no-referrer" />
        ) : (
          <span className="no-video-initial">
            {displayName.trim().charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <strong>{displayName}</strong>
    </div>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const pathRoomId = location.pathname
    .replace(/^\/meeting\/?/, "")
    .replace(/^\/+/, "");
  const requestedRoomId = query.get("roomId") || pathRoomId || "";
  const editHuddleLink = query.get("edit");
  const [user, setUser] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [unreadChat, setUnreadChat] = useState(false);
  const [huddle, setHuddle] = useState(null);
  const [generatedHuddle, setGeneratedHuddle] = useState(null);
  const [joinError, setJoinError] = useState("");
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [menuSticky, setMenuSticky] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [huddleForm, setHuddleForm] = useState({
    title: "",
    purpose: "",
    hostEmail: "",
    scheduledAt: "",
    duration: "30",
    isPrivate: false,
  });
  const [huddleMode, setHuddleMode] = useState("instant");
  const [activityTab, setActivityTab] = useState("personal");
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [pinnedParticipantId, setPinnedParticipantId] = useState(null);
  const [mutedParticipantIds, setMutedParticipantIds] = useState({});
  const [handRaised, setHandRaised] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);
  const [shareLinkUrl, setShareLinkUrl] = useState("");
  const [profileForm, setProfileForm] = useState({
    displayName: "",
    email: "",
    picture: "",
  });
  const [activityMetrics, setActivityMetrics] = useState({
    hosted: 0,
    joined: 0,
    attendees: 0,
  });
  const [upcomingMeets, setUpcomingMeets] = useState([]);
  const [showProfileImagePicker, setShowProfileImagePicker] = useState(false);
  const [profileSection, setProfileSection] = useState("account");
  const [audioTestMessage, setAudioTestMessage] = useState("");
  const [micTestResult, setMicTestResult] = useState(null);
  const [micTestRunning, setMicTestRunning] = useState(false);
  const [micTestLevels, setMicTestLevels] = useState([]);
  const [cameraTestMessage, setCameraTestMessage] = useState("");
  const [cameraTestResult, setCameraTestResult] = useState(null);
  const [cameraTestRunning, setCameraTestRunning] = useState(false);
  const [previewStream, setPreviewStream] = useState(null);
  const [blurEnabled, setBlurEnabled] = useState(false);
  const [planLevel, setPlanLevel] = useState("Pro");
  const [handRaiseNotice, setHandRaiseNotice] = useState(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const micStreamRef = useRef(null);
  const micSourceRef = useRef(null);
  const micAnimationRef = useRef(null);
  const micTestTimerRef = useRef(null);
  const cameraTestTimerRef = useRef(null);
  const cameraTestDelayRef = useRef(null);
  const theme = useTimeTheme();
  const isProfileRoute = location.pathname === "/profile";
  const socketRef = useRef(null);
  const approvalSocketRef = useRef(null);
  const approvalAudioContextRef = useRef(null);
  const approvalTimeoutsRef = useRef({});
  const joinAcceptTimeoutRef = useRef(null);
  const joinRequestTimeoutRef = useRef(null);
  const localVideoRef = useRef(null);
  const profilePreviewRef = useRef(null);
  const createMenuRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const approvalDrawerRef = useRef(null);
  const chatPanelRef = useRef(null);
  const peersRef = useRef({});
  const localStreamRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const screenShareStreamRef = useRef(null);
  const [participants, setParticipants] = useState({});
  const [fullscreenId, setFullscreenId] = useState(null);
  const [now, setNow] = useState(new Date());
  const [reactions, setReactions] = useState([]);
  const [showEmojiMenu, setShowEmojiMenu] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [approvalDrawerOpen, setApprovalDrawerOpen] = useState(false);
  const [joinApprovalPending, setJoinApprovalPending] = useState(false);
  const [joinAcceptedPending, setJoinAcceptedPending] = useState(false);
  const [joinApprovalMessage, setJoinApprovalMessage] = useState("");
  const [joinDeclineModalOpen, setJoinDeclineModalOpen] = useState(false);
  const [joinDeclineMessage, setJoinDeclineMessage] = useState("");
  const [approvalRoomId, setApprovalRoomId] = useState("");
  const [speakingParticipants, setSpeakingParticipants] = useState({});
  // transient loaders for smooth UX transitions
  const [showSigningInLoader, setShowSigningInLoader] = useState(false);
  const [showJoiningLoader, setShowJoiningLoader] = useState(false);
  // numeric mic levels for local and remote participants (0..1)
  const [speakingLevels, setSpeakingLevels] = useState({});
  const [kicked, setKicked] = useState(false);
  const [emailOtp, setEmailOtp] = useState("");
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
  const [profileToast, setProfileToast] = useState("");
  const {
    stats: liveActivityStats,
    pastMeetings,
    refetch: refetchActivity,
  } = useUserActivityStats(user?.id, user?.token);

  const getAudioTrackEnabled = (stream) =>
    Boolean(stream?.getAudioTracks()?.[0]?.enabled);

  useEffect(() => {
    if (!localStream || !micEnabled) {
      setSpeakingParticipants((current) => ({ ...current, local: false }));
      return undefined;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) {
      setSpeakingParticipants((current) => ({ ...current, local: false }));
      return undefined;
    }

    const audioContext =
      audioContextRef.current ||
      new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(
      new MediaStream([audioTrack]),
    );
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let active = true;

    const sample = () => {
      if (!active) return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) {
        peak = Math.max(peak, Math.abs(data[i] - 128));
      }
      // normalize peak to 0..1 (128 is max center distance for 8-bit pcm)
      const level = Math.min(1, peak / 64);
      const isSpeaking = peak > 16;
      setSpeakingParticipants((current) => ({
        ...current,
        local: isSpeaking,
      }));
      setSpeakingLevels((current) => ({ ...current, local: level }));
      requestAnimationFrame(sample);
    };
    sample();

    return () => {
      active = false;
      setSpeakingParticipants((current) => ({ ...current, local: false }));
    };
  }, [localStream, micEnabled]);

  const activeRoomId =
    huddle?.link || generatedHuddle?.link || requestedRoomId || roomId;
  const hostEmail =
    huddle?.hostEmail || generatedHuddle?.hostEmail || huddleForm.hostEmail;
  const isHost = Boolean(
    user?.email &&
    hostEmail &&
    user.email.toLowerCase() === hostEmail.toLowerCase(),
  );
  const isMeetingRoute =
    location.pathname === "/meeting" ||
    location.pathname.startsWith("/meeting/");
  const isCreateHuddleRoute =
    location.pathname === "/create-huddle" ||
    location.pathname.startsWith("/create-huddle/");
  const showApprovalButton = Boolean(
    isMeetingRoute && isPrivate && activeRoomId && isHost,
  );
  const canReceiveApprovalRequests = Boolean(
    isMeetingRoute && isHost && isPrivate && activeRoomId,
  );
  const pendingApprovalCount = approvalRequests.filter(
    (request) => request.status === "pending",
  ).length;
  const localHasVideo = Boolean(
    localStream && (cameraEnabled || screenSharing),
  );
  const localInitial = (user?.displayName || user?.email || "Guest")
    .charAt(0)
    .toUpperCase();
  const getParticipantInitial = (socketId) => {
    const displayName =
      participants[socketId]?.displayName ||
      participants[socketId]?.email ||
      socketId ||
      "Guest";
    return String(displayName).trim().charAt(0).toUpperCase();
  };
  const canManageParticipants = Boolean(isHost && huddle?.link);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const addReaction = (emoji, displayName = "Guest") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const left = 10 + Math.random() * 80; // percent from left
    const reaction = { id, emoji, displayName, left };
    setReactions((r) => [...r, reaction]);
    // remove after animation (2.6s)
    setTimeout(() => {
      setReactions((r) => r.filter((x) => x.id !== id));
    }, 2600);
  };

  const handleSendEmoji = (emoji) => {
    // emit to server for others
    try {
      socketRef.current?.emit("emoji-reaction", {
        emoji,
        sender: user?.id || "guest",
        displayName: user?.displayName || "Guest",
      });
    } catch (e) {
      // ignore
    }
    // show locally immediately
    addReaction(emoji, user?.displayName || user?.email || "Guest");
    setShowEmojiMenu(false);
  };
  const isGoogleConfigured = Boolean(
    import.meta.env.VITE_GOOGLE_CLIENT_ID &&
    import.meta.env.VITE_GOOGLE_CLIENT_ID !== "your-google-client-id" &&
    import.meta.env.VITE_GOOGLE_CLIENT_ID !== "demo-client-id",
  );

  useEffect(() => {
    const stored = localStorage.getItem("meetly-user");
    if (stored) {
      const savedUser = JSON.parse(stored);
      setUser(savedUser);
      setProfileForm({
        displayName: savedUser.displayName || "",
        email: savedUser.email || "",
        picture: savedUser.picture || "",
      });
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        createMenuRef.current &&
        !createMenuRef.current.contains(event.target)
      ) {
        setShowCreateMenu(false);
        setMenuSticky(false);
      }
    };

    if (showCreateMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showCreateMenu]);

  useEffect(() => {
    const handlePanelClickOutside = (event) => {
      const clickedApprovalTrigger = event.target.closest(
        "[data-approval-trigger='true']",
      );
      const clickedChatTrigger = event.target.closest(
        "[data-chat-trigger='true']",
      );
      const clickedInsideApproval = approvalDrawerRef.current?.contains(
        event.target,
      );
      const clickedInsideChat = chatPanelRef.current?.contains(event.target);

      if (
        approvalDrawerOpen &&
        !clickedInsideApproval &&
        !clickedApprovalTrigger
      ) {
        setApprovalDrawerOpen(false);
      }

      if (showChat && !clickedInsideChat && !clickedChatTrigger) {
        setShowChat(false);
      }
    };

    document.addEventListener("mousedown", handlePanelClickOutside);
    document.addEventListener("touchstart", handlePanelClickOutside);

    return () => {
      document.removeEventListener("mousedown", handlePanelClickOutside);
      document.removeEventListener("touchstart", handlePanelClickOutside);
    };
  }, [approvalDrawerOpen, showChat]);

  useEffect(() => {
    if (user) {
      setProfileForm({
        displayName: user.displayName || "",
        email: user.email || "",
        picture: user.picture || "",
      });
    }
  }, [user]);

  // Incoming join request notification (distinct tone)
  const playIncomingJoinSound = () => {
    try {
      const context =
        approvalAudioContextRef.current ||
        new (window.AudioContext || window.webkitAudioContext)();
      approvalAudioContextRef.current = context;
      const gain = context.createGain();
      const oscA = context.createOscillator();
      const oscB = context.createOscillator();
      oscA.type = "sine";
      oscB.type = "square";
      oscA.frequency.setValueAtTime(720, context.currentTime);
      oscB.frequency.setValueAtTime(1080, context.currentTime + 0.03);
      gain.gain.setValueAtTime(0.16, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45);
      oscA.connect(gain);
      oscB.connect(gain);
      gain.connect(context.destination);
      oscA.start();
      oscB.start();
      oscA.stop(context.currentTime + 0.45);
      oscB.stop(context.currentTime + 0.45);
    } catch (error) {
      console.warn("Unable to play incoming-join sound", error);
    }
  };

  // Participant successfully joined tone (distinct from incoming request)
  const playParticipantJoinedSound = () => {
    try {
      const context =
        approvalAudioContextRef.current ||
        new (window.AudioContext || window.webkitAudioContext)();
      approvalAudioContextRef.current = context;
      const gain = context.createGain();
      const osc = context.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(620, context.currentTime);
      gain.gain.setValueAtTime(0.12, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.38);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.38);
    } catch (error) {
      console.warn("Unable to play participant-joined sound", error);
    }
  };

  const handleApprovalRequest = (payload) => {
    const roomKey =
      payload?.roomId ||
      activeRoomId ||
      requestedRoomId ||
      roomId ||
      huddle?.link ||
      generatedHuddle?.link;
    if (
      !payload?.roomId ||
      (activeRoomId &&
        payload.roomId !== activeRoomId &&
        payload.roomId !== requestedRoomId &&
        payload.roomId !== roomId &&
        payload.roomId !== huddle?.link &&
        payload.roomId !== generatedHuddle?.link)
    ) {
      return;
    }

    const newRequest = {
      id: `${payload.guestEmail || payload.guestName || "guest"}-${Date.now()}`,
      guestName: payload.guestName || "Guest",
      guestEmail: payload.guestEmail || "guest@example.com",
      guestAvatar: payload.guestAvatar || payload.avatar || null,
      guestSocketId: payload.guestSocketId || payload.socketId || null,
      status: "pending",
      createdAt: Date.now(),
    };

    // Add to pending requests (do not auto-open drawer; notify with sound and badge)
    setApprovalRequests((previous) => {
      const next = [
        newRequest,
        ...previous.filter(
          (item) =>
            item.guestEmail !== newRequest.guestEmail ||
            item.status !== "pending",
        ),
      ];
      return next.slice(0, 8);
    });

    if (approvalTimeoutsRef.current[newRequest.id]) {
      clearTimeout(approvalTimeoutsRef.current[newRequest.id]);
    }
    approvalTimeoutsRef.current[newRequest.id] = window.setTimeout(() => {
      setApprovalRequests((previous) =>
        previous.map((item) =>
          item.id === newRequest.id ? { ...item, status: "expired" } : item,
        ),
      );
      if (approvalSocketRef.current) {
        approvalSocketRef.current.emit("reject-request", {
          roomId: activeRoomId,
          guestSocketId: newRequest.guestSocketId,
          reason: "timeout",
        });
      }
      delete approvalTimeoutsRef.current[newRequest.id];
    }, 30000);

    // Play a distinct incoming join request sound (do not auto-popup modal)
    try {
      playIncomingJoinSound();
    } catch (e) {
      console.warn("Incoming join sound failed", e);
    }
  };

  const clearGuestJoinAcceptance = () => {
    if (joinAcceptTimeoutRef.current) {
      clearTimeout(joinAcceptTimeoutRef.current);
      joinAcceptTimeoutRef.current = null;
    }
  };

  const clearGuestJoinRequest = () => {
    if (joinRequestTimeoutRef.current) {
      clearTimeout(joinRequestTimeoutRef.current);
      joinRequestTimeoutRef.current = null;
    }
    if (approvalSocketRef.current) {
      approvalSocketRef.current.disconnect();
      approvalSocketRef.current = null;
    }
  };

  const beginGuestJoinNavigation = (roomId) => {
    clearGuestJoinAcceptance();
    clearGuestJoinRequest();
    setJoinApprovalPending(false);
    setJoinAcceptedPending(true);
    setJoinApprovalMessage("Host approved your request. Joining meeting...");
    setJoinDeclineModalOpen(false);
    setJoinDeclineMessage("");

    // show a short joining loader before navigating (1.5s)
    setShowJoiningLoader(true);
    joinAcceptTimeoutRef.current = window.setTimeout(() => {
      setJoinAcceptedPending(false);
      setJoinApprovalMessage("");
      setShowJoiningLoader(false);
      navigate(`/meeting/${encodeURIComponent(roomId)}`);
    }, 1500);
  };

  const handleGuestJoinDecline = (message) => {
    clearGuestJoinAcceptance();
    clearGuestJoinRequest();
    setJoinApprovalPending(false);
    setJoinAcceptedPending(false);
    setJoinApprovalMessage("");
    setJoinDeclineMessage(message || "Host declined your join request.");
    setJoinDeclineModalOpen(true);
  };

  const respondToApprovalRequest = (request, approved) => {
    if (approvalTimeoutsRef.current[request.id]) {
      clearTimeout(approvalTimeoutsRef.current[request.id]);
      delete approvalTimeoutsRef.current[request.id];
    }

    setApprovalRequests((previous) => {
      const next = previous.map((item) =>
        item.id === request.id
          ? { ...item, status: approved ? "accepted" : "declined" }
          : item,
      );
      // if no pending requests remain, auto-close the drawer
      const stillPending = next.some((it) => it.status === "pending");
      if (!stillPending) {
        setApprovalDrawerOpen(false);
      }
      return next;
    });

    if (approvalSocketRef.current) {
      approvalSocketRef.current.emit(
        approved ? "accept-join-request" : "decline-join-request",
        {
          roomId: activeRoomId,
          guestSocketId: request.guestSocketId,
          reason: approved ? "accepted" : "declined",
        },
      );
    }
  };

  useEffect(() => {
    if (!canReceiveApprovalRequests || !activeRoomId) {
      return undefined;
    }

    if (approvalSocketRef.current) {
      approvalSocketRef.current.disconnect();
      approvalSocketRef.current = null;
    }

    const socket = io({ transports: ["websocket"] });
    approvalSocketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-room", {
        roomId: activeRoomId,
        displayName: user?.displayName || "Host",
        email: user?.email || "",
        avatar: user?.picture || null,
        isHost: true,
      });
    });

    socket.on("incoming-join-request", (payload) => {
      handleApprovalRequest(payload);
    });

    socket.on("join-request", (payload) => {
      handleApprovalRequest(payload);
    });

    return () => {
      socket.disconnect();
      approvalSocketRef.current = null;
    };
  }, [
    activeRoomId,
    canReceiveApprovalRequests,
    user?.displayName,
    user?.email,
    user?.picture,
  ]);

  const stopMicTest = () => {
    if (micAnimationRef.current) {
      cancelAnimationFrame(micAnimationRef.current);
      micAnimationRef.current = null;
    }
    if (micTestTimerRef.current) {
      clearTimeout(micTestTimerRef.current);
      micTestTimerRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (micSourceRef.current) {
      micSourceRef.current.disconnect();
      micSourceRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    setMicTestRunning(false);
  };

  useEffect(() => {
    return () => {
      stopMicTest();
    };
  }, []);

  useEffect(() => {
    if (!location.pathname.startsWith("/meeting")) return undefined;

    let cancelled = false;
    let socket = null;
    let meetingStream = null;
    const startMeeting = async () => {
      setJoinError("");
      if (requestedRoomId) {
        try {
          const { data } = await axios.get(
            `/api/huddles/${encodeURIComponent(requestedRoomId)}`,
          );
          if (data?.huddle) {
            setHuddle(data.huddle);
            setIsPrivate(Boolean(data.huddle.isPrivate));
          }
        } catch (error) {
          if (cancelled) {
            setMeetingLoading(false);
            return null;
          }
          setJoinError(
            error.response?.status === 410
              ? "The room was ended. Contact your meet host."
              : error.response?.status === 425
                ? "This code is not scheduled for now. Enter a valid code."
                : "Wrong meet ID. Enter a meet ID created by Huddle Now.",
          );
          setMeetingLoading(false);
          navigate("/");
          return null;
        }
      }

      if (cancelled) {
        setMeetingLoading(false);
        return null;
      }

      try {
        setMeetingLoading(true);
        if (previewStream) {
          try {
            previewStream.getTracks().forEach((t) => t.stop());
          } catch (e) {
            // ignore
          }
          setPreviewStream(null);
          if (profilePreviewRef.current) {
            profilePreviewRef.current.srcObject = null;
          }
        }

        const stream = new MediaStream();
        if (stream) {
          meetingStream = stream;
          cameraTrackRef.current = stream.getVideoTracks()[0] || null;
          attachCameraEndedListener(cameraTrackRef.current);
          localStreamRef.current = stream;
          setLocalStream(stream);
          if (
            localVideoRef.current &&
            localVideoRef.current.srcObject !== stream
          ) {
            try {
              localVideoRef.current.srcObject = stream;
            } catch (err) {
              // ignore assignment errors
            }
          }
          setMicEnabled(getAudioTrackEnabled(stream));
          setCameraEnabled(Boolean(stream.getVideoTracks().length));
          setScreenSharing(false);
          return stream;
        }

        setLocalStream(null);
        setMicEnabled(false);
        setCameraEnabled(false);
        setJoinError(
          "Camera and microphone access were unavailable, so the meeting will continue without them. You can enable permissions later.",
        );
        return null;
      } catch (error) {
        console.error("Unable to open media devices", error);
        setLocalStream(null);
        setMicEnabled(false);
        setCameraEnabled(false);
        setJoinError(
          "Camera and microphone access were unavailable, so the meeting will continue without them. You can enable permissions later.",
        );
        return null;
      } finally {
        setMeetingLoading(false);
      }
    };

    const initMeeting = async () => {
      const stream = await startMeeting();
      if (cancelled) return;

      socket = io({ transports: ["websocket"] });
      socketRef.current = socket;

      const createPeer = (peerId, initiator) => {
        if (!peerId || peerId === socket.id) return null;
        if (peersRef.current[peerId]) return peersRef.current[peerId];

        const peer = new PeerConstructor({
          initiator,
          trickle: true,
          stream: stream || undefined,
          config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
        });

        peersRef.current[peerId] = peer;

        const startRemoteSpeakingMonitor = (remoteStream) => {
          if (!remoteStream) return;
          const audioTrack = remoteStream.getAudioTracks()[0];
          if (!audioTrack) return;
          const audioContext =
            audioContextRef.current ||
            new (window.AudioContext || window.webkitAudioContext)();
          audioContextRef.current = audioContext;
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          const source = audioContext.createMediaStreamSource(
            new MediaStream([audioTrack]),
          );
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);

          const sample = () => {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (let i = 0; i < data.length; i += 1) {
              peak = Math.max(peak, Math.abs(data[i] - 128));
            }
            const level = Math.min(1, peak / 64);
            const isSpeaking = peak > 16;
            setSpeakingParticipants((current) => ({
              ...current,
              [peerId]: isSpeaking,
            }));
            setSpeakingLevels((current) => ({ ...current, [peerId]: level }));
            requestAnimationFrame(sample);
          };
          sample();
        };

        peer.on("signal", (signalData) => {
          if (initiator) {
            socket.emit("offer", {
              to: peerId,
              from: socket.id,
              signal: signalData,
            });
          } else {
            socket.emit("answer", {
              to: peerId,
              from: socket.id,
              signal: signalData,
            });
          }
        });

        peer.on("stream", (remoteStream) => {
          setRemoteStreams((previous) => ({
            ...previous,
            [peerId]: remoteStream,
          }));
          startRemoteSpeakingMonitor(remoteStream);
        });

        peer.on("error", (error) => {
          console.warn(`Peer error with ${peerId}`, error);
          if (!peer.destroyed) peer.destroy();
          if (peersRef.current[peerId] === peer) {
            delete peersRef.current[peerId];
          }
        });

        peer.on("close", () => {
          if (peersRef.current[peerId] === peer) {
            delete peersRef.current[peerId];
          }
        });

        return peer;
      };

      const ensurePeerForRemote = (peerId) => {
        if (!peerId || peerId === socket.id) return null;
        if (peersRef.current[peerId]) return peersRef.current[peerId];
        return createPeer(peerId, socket.id < peerId);
      };

      socket.on("connect", () => {
        const roomToJoin =
          requestedRoomId || roomId || huddle?.link || generatedHuddle?.link;
        socket.emit("join-room", {
          roomId: roomToJoin,
          displayName: user?.displayName || "Guest",
          email: user?.email || "",
          avatar: user?.picture || null,
          isHost: Boolean(
            user?.email &&
            (huddle?.hostEmail || generatedHuddle?.hostEmail) &&
            user.email.toLowerCase() ===
              (
                huddle?.hostEmail ||
                generatedHuddle?.hostEmail ||
                ""
              ).toLowerCase(),
          ),
        });
        // announce presence (displayName and optional avatar)
        socket.emit("announce", {
          roomId: roomToJoin,
          displayName: user?.displayName || "Guest",
          avatar: user?.picture || null,
          email: user?.email || "",
        });
        setJoined(true);
      });

      socket.on("existing-participants", (list) => {
        const map = {};
        (list || []).forEach((p) => {
          map[p.socketId] = {
            displayName: p.displayName,
            email: p.email,
            avatar: p.avatar,
            picture: p.picture,
            videoEnabled: Boolean(p.videoEnabled),
            micEnabled: Boolean(p.micEnabled),
            speakingLevel: p.speakingLevel || 0,
          };
          if (p.socketId !== socket.id) {
            ensurePeerForRemote(p.socketId);
          }
        });
        setParticipants(map);
      });

      socket.on(
        "participant-joined",
        ({ socketId, displayName, avatar, email }) => {
          setParticipants((prev) => ({
            ...prev,
            [socketId]: {
              displayName,
              avatar,
              email,
              picture: avatar,
              videoEnabled: false,
              micEnabled: false,
              speakingLevel: 0,
            },
          }));
          // play unique sound to indicate participant successfully joined
          try {
            playParticipantJoinedSound();
          } catch (e) {
            console.warn("Participant joined sound failed", e);
          }
        },
      );

      socket.on("hand-raise", ({ sender, displayName, raised }) => {
        if (sender === user?.id) return;
        if (raised) {
          setHandRaiseNotice(`${displayName || "Someone"} raised their hand.`);
          playHandRaiseSound();
          window.setTimeout(() => setHandRaiseNotice(null), 5500);
        }
      });

      socket.on("participant-left", ({ socketId }) => {
        setParticipants((prev) => {
          const cp = { ...prev };
          delete cp[socketId];
          return cp;
        });
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[socketId];
          return next;
        });
        if (peersRef.current[socketId]) {
          peersRef.current[socketId].destroy();
          delete peersRef.current[socketId];
        }
      });

      socket.on(
        "participant-media-state",
        ({ socketId, videoEnabled, micEnabled, speakingLevel = 0 }) => {
          setParticipants((previous) => ({
            ...previous,
            [socketId]: {
              ...previous[socketId],
              videoEnabled,
              micEnabled,
              speakingLevel,
            },
          }));
          setSpeakingLevels((previous) => ({
            ...previous,
            [socketId]: speakingLevel,
          }));
        },
      );

      socket.on("chat-message", ({ sender, text, displayName }) => {
        if (sender !== (user?.id || "guest") && !showChat) {
          setUnreadChat(true);
        }
        setChatMessages((previous) => [
          ...previous,
          {
            id: `${sender}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            sender,
            text,
            displayName: displayName || sender,
            timestamp: new Date().toISOString(),
          },
        ]);
      });

      socket.on("emoji-reaction", ({ emoji, displayName, sender }) => {
        // show reaction received from others
        addReaction(emoji, displayName || sender || "Guest");
      });

      socket.on("set-private", ({ isPrivate: p }) => {
        setIsPrivate(Boolean(p));
      });

      socket.on("incoming-join-request", (payload) => {
        handleApprovalRequest(payload);
      });

      socket.on("join-request", (payload) => {
        handleApprovalRequest(payload);
      });

      socket.on("approval-request-room", (payload) => {
        handleApprovalRequest(payload);
      });

      socket.on("accept", (payload) => {
        if (
          payload.roomId &&
          payload.roomId ===
            (requestedRoomId || roomId || huddle?.link || generatedHuddle?.link)
        ) {
          beginGuestJoinNavigation(payload.roomId);
        }
      });

      socket.on("decline", (payload) => {
        if (
          payload.roomId &&
          payload.roomId ===
            (requestedRoomId || roomId || huddle?.link || generatedHuddle?.link)
        ) {
          const message =
            payload.reason === "timeout"
              ? "The host did not respond in time. Please try again."
              : "Host declined your join request.";
          handleGuestJoinDecline(message);
        }
      });

      socket.on("accept-request", (payload) => {
        if (
          payload.roomId &&
          payload.roomId ===
            (requestedRoomId || roomId || huddle?.link || generatedHuddle?.link)
        ) {
          beginGuestJoinNavigation(payload.roomId);
        }
      });

      socket.on("decline-request", (payload) => {
        if (
          payload.roomId &&
          payload.roomId ===
            (requestedRoomId || roomId || huddle?.link || generatedHuddle?.link)
        ) {
          const message =
            payload.reason === "timeout"
              ? "The host did not respond in time. Please try again."
              : "Host declined your join request.";
          handleGuestJoinDecline(message);
        }
      });

      socket.on("join-request-approved", (payload) => {
        if (
          payload.roomId &&
          payload.roomId ===
            (requestedRoomId || roomId || huddle?.link || generatedHuddle?.link)
        ) {
          beginGuestJoinNavigation(payload.roomId);
        }
      });

      socket.on("join-request-declined", (payload) => {
        if (
          payload.roomId &&
          payload.roomId ===
            (requestedRoomId || roomId || huddle?.link || generatedHuddle?.link)
        ) {
          const message =
            payload.reason === "timeout"
              ? "The host did not respond in time. Please try again."
              : "Host declined your join request.";
          handleGuestJoinDecline(message);
        }
      });

      socket.on("mute-all", ({ by }) => {
        // mute local audio
        try {
          const track = localStreamRef.current?.getAudioTracks()?.[0];
          if (track) {
            track.enabled = false;
            setMicEnabled(false);
          }
        } catch (e) {}
      });

      socket.on("kick-out", ({ targetSocketId, by }) => {
        if (socket.id === targetSocketId) {
          // show kicked UI
          setKicked(true);
        }
      });

      socket.on("you-are-kicked", ({ roomId: r, by }) => {
        setKicked(true);
      });

      socket.on("user-connected", ({ socketId }) => {
        if (socketId === socket.id) return;
        ensurePeerForRemote(socketId);
      });

      socket.on("offer", ({ from, signal }) => {
        const peer = peersRef.current[from] || createPeer(from, false);
        if (!peer) return;
        try {
          peer.signal(signal);
        } catch (error) {
          console.warn(`Unable to process offer from ${from}`, error);
        }
      });

      socket.on("answer", ({ from, signal }) => {
        const peer = peersRef.current[from];
        if (!peer) return;
        try {
          peer.signal(signal);
        } catch (error) {
          console.warn(`Unable to process answer from ${from}`, error);
        }
      });

      socket.on("ice-candidate", ({ from, signal }) => {
        const peer = peersRef.current[from];
        if (!peer) return;
        try {
          peer.signal(signal);
        } catch (error) {
          console.warn(`Unable to process ice candidate from ${from}`, error);
        }
      });
    };

    const cleanupMeeting = () => {
      cancelled = true;
      if (socket) {
        socket.disconnect();
      }
      Object.values(peersRef.current).forEach((peer) => peer.destroy());
      peersRef.current = {};
      if (meetingStream) {
        meetingStream.getTracks().forEach((track) => track.stop());
        meetingStream = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      if (screenShareStreamRef.current) {
        screenShareStreamRef.current
          .getTracks()
          .forEach((track) => track.stop());
        screenShareStreamRef.current = null;
      }
    };

    initMeeting();
    return cleanupMeeting;
  }, [location.pathname, roomId, requestedRoomId, navigate]);

  useEffect(() => {
    if (localStream) {
      localStreamRef.current = localStream;
    }
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play?.().catch(() => {});
    }
  }, [localStream, cameraEnabled, screenSharing]);

  useEffect(() => {
    Object.entries(remoteStreams).forEach(([socketId, stream]) => {
      const videoElement = remoteVideoRefs.current[socketId];
      if (videoElement && videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
      }
    });
  }, [remoteStreams]);

  useEffect(() => {
    if (!showChat) return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    chatInputRef.current?.focus();
  }, [chatMessages, showChat]);

  useEffect(() => {
    if (!editHuddleLink) return undefined;
    axios
      .get(`/api/huddles/${encodeURIComponent(editHuddleLink)}`)
      .then(({ data }) => {
        setHuddle(data.huddle);
        setHuddleForm({
          title: data.huddle.title,
          purpose: data.huddle.purpose,
          hostEmail: data.huddle.hostEmail,
          scheduledAt: new Date(data.huddle.scheduledAt)
            .toISOString()
            .slice(0, 16),
          duration: String(data.huddle.duration),
          isPrivate: Boolean(data.huddle.isPrivate),
        });
        setHuddleMode(
          new Date(data.huddle.scheduledAt) <= new Date()
            ? "instant"
            : "scheduled",
        );
      })
      .catch(() => navigate("/"));
    return undefined;
  }, [editHuddleLink, navigate]);

  const handleGuestContinue = () => {
    const profile = {
      id: `guest-${Date.now()}`,
      email: "guest@local.dev",
      displayName: "Guest User",
      roomId,
      picture: null,
      token: "local-guest-token",
    };
    localStorage.setItem("meetly-user", JSON.stringify(profile));
    setUser(profile);
    navigate("/");
  };

  const handleSignOut = () => {
    localStorage.removeItem("meetly-user");
    setUser(null);
    navigate("/");
  };

  const saveProfileUpdates = (event) => {
    event.preventDefault();
    const updatedProfile = {
      ...user,
      displayName: profileForm.displayName,
      email: profileForm.email,
      picture: profileForm.picture,
    };
    setUser(updatedProfile);
    localStorage.setItem("meetly-user", JSON.stringify(updatedProfile));
    window.alert("Profile settings updated.");
  };

  const handleShareMeet = (meet) => {
    const link = `${window.location.origin}/meeting?roomId=${encodeURIComponent(meet.link)}`;
    setShareLinkUrl(link);
    setShareModalOpen(true);
  };

  const shareToTarget = (target) => {
    const text = encodeURIComponent(`Join my Huddle: ${shareLinkUrl}`);
    const encodedUrl = encodeURIComponent(shareLinkUrl);
    let url = "";
    switch (target) {
      case "whatsapp":
        url = `https://api.whatsapp.com/send?text=${text}`;
        break;
      case "linkedin":
        url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
        break;
      case "twitter":
        url = `https://twitter.com/intent/tweet?text=${text}`;
        break;
      case "copy":
        navigator.clipboard.writeText(shareLinkUrl);
        window.alert("Meet link copied to clipboard.");
        return;
      default:
        return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const toggleParticipantPin = (participantId) => {
    setPinnedParticipantId((previous) =>
      previous === participantId ? null : participantId,
    );
  };

  const toggleParticipantMute = async (participantId) => {
    setMutedParticipantIds((previous) => ({
      ...previous,
      [participantId]: !previous[participantId],
    }));
    if (participantId !== "local") return;

    const stream = localStreamRef.current || localStream;
    if (!stream) return;

    let audioTrack = stream.getAudioTracks()[0];
    const previousTrack = audioTrack;
    if (audioTrack && audioTrack.readyState === "ended") {
      stream.removeTrack(audioTrack);
      audioTrack = null;
    }

    if (!audioTrack) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) {
          stream.addTrack(audioTrack);
          setLocalStream(stream);
          localStreamRef.current = stream;
          attachLocalAudioTrackToPeers(audioTrack, stream);
        }
      } catch (error) {
        console.error("Unable to enable microphone", error);
        setMicEnabled(false);
        return;
      }
    }

    if (!audioTrack) return;
    const nextState = !audioTrack.enabled;
    audioTrack.enabled = nextState;
    setMicEnabled(nextState);
    if (nextState) {
      attachLocalAudioTrackToPeers(audioTrack, stream, previousTrack);
    }
  };

  const playHandRaiseSound = () => {
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(520, context.currentTime);
      gain.gain.setValueAtTime(0.15, context.currentTime);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.16);
    } catch (error) {
      console.warn("Unable to play notification sound", error);
    }
  };

  const toggleHandRaise = () => {
    const nextState = !handRaised;
    setHandRaised(nextState);
    if (nextState) {
      playHandRaiseSound();
    }
    if (socketRef.current) {
      socketRef.current.emit("hand-raise", {
        roomId: requestedRoomId || roomId,
        sender: user?.id || "guest",
        displayName: user?.displayName || "Guest",
        raised: nextState,
      });
    }
  };

  const togglePrivate = (next) => {
    setIsPrivate(Boolean(next));
    try {
      socketRef.current?.emit("set-private", {
        roomId: requestedRoomId || roomId,
        isPrivate: Boolean(next),
      });
    } catch (e) {}
  };

  // removed: requestToJoin is no longer used in this UX

  // removed join accept/reject handlers per new UX

  const performMuteAll = () => {
    try {
      socketRef.current?.emit("mute-all", {
        roomId: requestedRoomId || roomId,
      });
    } catch (e) {}
  };

  const performKick = (targetSocketId) => {
    if (
      !canManageParticipants ||
      !targetSocketId ||
      targetSocketId === socketRef.current?.id
    )
      return;
    try {
      socketRef.current?.emit("kick-out", {
        roomId: requestedRoomId || roomId,
        targetSocketId,
      });
    } catch (e) {}
  };

  const handleProfilePictureUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setProfileForm((previous) => ({
        ...previous,
        picture: reader.result,
      }));
      setShowProfileImagePicker(false);
    };
    reader.readAsDataURL(file);
  };

  const handleAudioTest = async () => {
    stopMicTest();
    setMicTestRunning(true);
    setMicTestResult(null);
    setMicTestLevels([]);
    setAudioTestMessage("Testing microphone…");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const audioContext =
        audioContextRef.current ||
        new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      micSourceRef.current = source;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let peakLevel = 0;
      const sampleStart = performance.now();

      const updateWaveform = () => {
        analyser.getByteTimeDomainData(data);
        const levels = Array.from({ length: 20 }, (_, index) => {
          const offset = Math.floor((index * data.length) / 20);
          const value = data[offset] || 128;
          return Math.max(4, Math.round((Math.abs(value - 128) / 128) * 100));
        });
        setMicTestLevels(levels);

        const framePeak = data.reduce((max, value) => {
          const amplitude = Math.abs(value - 128);
          return amplitude > max ? amplitude : max;
        }, 0);
        peakLevel = Math.max(peakLevel, framePeak);

        if (performance.now() - sampleStart < 1200) {
          micAnimationRef.current = requestAnimationFrame(updateWaveform);
        }
      };

      updateWaveform();

      await new Promise((resolve) => {
        micTestTimerRef.current = window.setTimeout(resolve, 1200);
      });

      const audioReady = peakLevel > 18;
      setMicTestResult(audioReady ? "ready" : "not-ready");
      setAudioTestMessage(
        audioReady ? "Your mic is ready." : "Your mic is not well.",
      );
    } catch (error) {
      console.error("Microphone test failed", error);
      setMicTestResult("not-ready");
      setAudioTestMessage(
        "Unable to access microphone. Check your permissions.",
      );
    } finally {
      micTestTimerRef.current = window.setTimeout(() => {
        setAudioTestMessage("");
      }, 3500);
      micTestTimerRef.current = window.setTimeout(() => {
        setMicTestResult(null);
      }, 4500);
      setTimeout(() => stopMicTest(), 1500);
    }
  };

  const handleCameraTest = async () => {
    setCameraTestRunning(true);
    setCameraTestResult(null);
    setCameraTestMessage("Checking your camera…");

    let cameraPassed = false;

    try {
      const stream = await startCameraPreview();
      if (!stream) {
        throw new Error("No camera detected");
      }

      const video = profilePreviewRef.current;
      if (!video) throw new Error("Preview unavailable");

      await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Video not ready")),
          1400,
        );
        const onReady = () => {
          clearTimeout(timeout);
          resolve();
        };

        if (video.videoWidth > 0 && video.videoHeight > 0) {
          clearTimeout(timeout);
          resolve();
        } else {
          video.addEventListener("loadedmetadata", onReady, { once: true });
          video.addEventListener("playing", onReady, { once: true });
        }
      });

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 160;
      canvas.height = video.videoHeight || 120;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      let sumSq = 0;
      let darkPixels = 0;
      const data = frame.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += avg;
        sumSq += avg * avg;
        if (avg < 18) darkPixels += 1;
      }
      const pixelCount = data.length / 4;
      const mean = sum / pixelCount;
      const variance = sumSq / pixelCount - mean * mean;
      const darkRatio = darkPixels / pixelCount;
      const hasContent =
        video.videoWidth > 20 &&
        video.videoHeight > 20 &&
        variance > 450 &&
        darkRatio < 0.9;

      cameraPassed = hasContent;
      setCameraTestResult(cameraPassed ? "ready" : "not-ready");
      setCameraTestMessage(
        cameraPassed ? "Your camera is ready." : "Check your camera.",
      );

      if (cameraPassed) {
        stopCameraPreview();
      }
    } catch (error) {
      console.error("Camera test failed", error);
      setCameraTestResult("not-ready");
      setCameraTestMessage(
        error.name === "NotAllowedError" ||
          error.name === "PermissionDeniedError"
          ? "Unable to access camera. Check your permissions."
          : "Check your camera.",
      );
    } finally {
      if (cameraTestDelayRef.current) {
        clearTimeout(cameraTestDelayRef.current);
      }
      if (!cameraPassed) {
        cameraTestTimerRef.current = window.setTimeout(() => {
          setCameraTestMessage("");
        }, 3500);
        cameraTestTimerRef.current = window.setTimeout(() => {
          setCameraTestResult(null);
        }, 4500);
      }
      setTimeout(() => setCameraTestRunning(false), 1500);
    }
  };

  const startCameraPreview = async () => {
    if (previewStream) {
      stopCameraPreview();
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      if (profilePreviewRef.current) {
        profilePreviewRef.current.srcObject = stream;
      }
      setPreviewStream(stream);
      return stream;
    } catch (error) {
      console.error("Unable to start camera preview", error);
      return null;
    }
  };

  const stopCameraPreview = () => {
    if (previewStream) {
      previewStream.getTracks().forEach((track) => track.stop());
      setPreviewStream(null);
    }
    if (profilePreviewRef.current) {
      profilePreviewRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      if (previewStream) {
        previewStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [previewStream]);

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const { data } = await axios.post("/api/auth/google", {
        credential: credentialResponse.credential,
        roomId,
        displayName: "Guest User",
      });

      // prefer picture returned by backend, but fallback to decoding the JWT credential payload
      let picture = data?.user?.picture;
      if (!picture && credentialResponse?.credential) {
        try {
          const base64Url = credentialResponse.credential.split(".")[1];
          const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
          const jsonPayload = decodeURIComponent(
            atob(base64)
              .split("")
              .map(function (c) {
                return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
              })
              .join(""),
          );
          const payload = JSON.parse(jsonPayload);
          picture = picture || payload?.picture || payload?.img || null;
        } catch (err) {
          // ignore decode errors
        }
      }

      const profile = {
        ...data.user,
        picture: getHighResGooglePhoto(picture || data?.user?.picture || null),
        token: data.token,
        roomId,
      };
      localStorage.setItem("meetly-user", JSON.stringify(profile));
      setUser(profile);

      // show a brief Signing in... loader for smooth UX, then navigate
      setShowSigningInLoader(true);
      setTimeout(() => {
        setShowSigningInLoader(false);
        navigate("/");
      }, 1500);
    } catch (error) {
      console.error(error);
      handleGuestContinue();
    }
  };

  const handleCreateHuddle = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        ...huddleForm,
        scheduledAt:
          huddleMode === "instant"
            ? new Date().toISOString()
            : new Date(huddleForm.scheduledAt).toISOString(),
        ownerId: user?.id,
      };
      const response = huddle
        ? await axios.patch(
            `/api/huddles/${encodeURIComponent(huddle.link)}`,
            payload,
          )
        : await axios.post("/api/huddles", payload);
      setHuddle(response.data.huddle);
      setGeneratedHuddle(response.data.huddle);
      setIsPrivate(Boolean(response.data.huddle.isPrivate));
      setHuddleForm((previous) => ({
        ...previous,
        isPrivate: Boolean(response.data.huddle.isPrivate),
      }));
    } catch (error) {
      console.error("Unable to save huddle", error);
      const backendMessage =
        error.response?.data?.error ||
        error.message ||
        "Unable to create the meet. Please check the details and try again.";
      window.alert(backendMessage);
    }
  };

  const handleJoinHuddle = async () => {
    const enteredLink = roomId.trim().split("/").pop().replace(/^#/, "");
    if (!enteredLink) {
      setJoinError("Enter a meet ID first.");
      return;
    }
    const requestedRoomId = enteredLink;
    setJoinApprovalPending(false);
    setJoinApprovalMessage("");
    try {
      const { data } = await axios.get(
        `/api/huddles/${encodeURIComponent(requestedRoomId)}`,
      );
      const targetHuddle = data.huddle;
      setHuddle(targetHuddle);
      setIsPrivate(Boolean(targetHuddle.isPrivate));
      setJoinError("");

      const isGuestRequest =
        Boolean(targetHuddle.isPrivate) &&
        !isHost &&
        user?.email !== targetHuddle.hostEmail;
      if (isGuestRequest) {
        setJoinApprovalPending(true);
        setJoinApprovalMessage("Waiting for host response...");
        if (approvalSocketRef.current) {
          approvalSocketRef.current.disconnect();
          approvalSocketRef.current = null;
        }
        const socket = io({ transports: ["websocket"] });
        approvalSocketRef.current = socket;
        socket.on("connect", () => {
          socket.emit("join-room", {
            roomId: requestedRoomId,
            displayName: user?.displayName || "Guest",
            email: user?.email || "",
            avatar: user?.picture || null,
            isHost: false,
            userId: user?.id || user?.sub || user?.email || socket.id,
            userName: user?.displayName || user?.email || "Guest",
          });
          window.setTimeout(() => {
            socket.emit("join-request", {
              roomId: requestedRoomId,
              userId: user?.id || user?.sub || user?.email || socket.id,
              userName: user?.displayName || user?.email || "Guest",
              userEmail: user?.email || "guest@example.com",
              guestSocketId: socket.id,
              guestName: user?.displayName || "Guest",
              guestEmail: user?.email || "guest@example.com",
            });
          }, 1000);
        });
        const handleGuestJoinApprovalPayload = (payload) => {
          if (payload.roomId === requestedRoomId) {
            beginGuestJoinNavigation(requestedRoomId);
          }
        };

        const handleGuestJoinDeclinePayload = (payload) => {
          if (payload.roomId === requestedRoomId) {
            const message =
              payload.reason === "timeout"
                ? "The host did not respond in time. Please try again."
                : "Host declined your join request.";
            handleGuestJoinDecline(message);
          }
        };

        socket.on("join-request-accepted", handleGuestJoinApprovalPayload);
        socket.on("join-request-declined", handleGuestJoinDeclinePayload);
        socket.on("approved", handleGuestJoinApprovalPayload);
        socket.on("rejected", handleGuestJoinDeclinePayload);
        socket.on("accept-join-request", handleGuestJoinApprovalPayload);
        socket.on("decline-join-request", handleGuestJoinDeclinePayload);
        socket.on("approve-request", handleGuestJoinApprovalPayload);
        socket.on("reject-request", handleGuestJoinDeclinePayload);
        socket.on("join-request-approved", handleGuestJoinApprovalPayload);
        joinRequestTimeoutRef.current = window.setTimeout(() => {
          if (approvalSocketRef.current === socket) {
            socket.emit("reject-request", {
              roomId: requestedRoomId,
              guestSocketId: socket.id,
              reason: "timeout",
            });
          }
        }, 30000);
        return;
      }

      // show joining loader briefly for a smooth UX before entering the meeting
      setShowJoiningLoader(true);
      setTimeout(() => {
        setShowJoiningLoader(false);
        navigate(`/meeting/${encodeURIComponent(data.huddle.link)}`);
      }, 1500);
    } catch (error) {
      console.error("Huddle link not found", error);
      setJoinError(
        error.response?.status === 410
          ? "The room was ended. Contact your meet host."
          : error.response?.status === 425
            ? "This code is not scheduled for now. Enter a valid code."
            : "Wrong meet ID. Enter a meet ID created by Huddle Now.",
      );
    }
  };

  const handleCopyMeetId = async () => {
    if (!generatedHuddle) return;
    await navigator.clipboard.writeText(generatedHuddle.link);
  };

  const attachCameraEndedListener = (track) => {
    if (!track) return;
    track.addEventListener("ended", () => {
      setCameraEnabled(false);
    });
  };

  const attachLocalAudioTrackToPeers = (
    audioTrack,
    stream,
    previousTrack = null,
  ) => {
    if (!audioTrack || !stream) return;

    Object.values(peersRef.current || {}).forEach((peer) => {
      if (!peer || peer.destroyed) return;

      try {
        if (
          previousTrack &&
          previousTrack !== audioTrack &&
          typeof peer.replaceTrack === "function"
        ) {
          peer.replaceTrack(previousTrack, audioTrack, stream);
        } else if (typeof peer.addTrack === "function") {
          peer.addTrack(audioTrack, stream);
        }
      } catch (error) {
        console.warn("Unable to attach local audio track to peer", error);
      }
    });

    audioTrack._addedToPeers = true;
  };

  const restoreCameraTrack = async () => {
    if (!localStream) return;

    if (
      !cameraTrackRef.current ||
      cameraTrackRef.current.readyState === "ended"
    ) {
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        cameraTrackRef.current = cameraStream.getVideoTracks()[0] || null;
        attachCameraEndedListener(cameraTrackRef.current);
      } catch (error) {
        console.error("Unable to restore camera track", error);
        return;
      }
    }

    const cameraTrack = cameraTrackRef.current;
    localStream.getVideoTracks().forEach((track) => {
      if (track !== cameraTrack) {
        localStream.removeTrack(track);
      }
    });

    if (cameraTrack && !localStream.getVideoTracks().includes(cameraTrack)) {
      localStream.addTrack(cameraTrack);
    }

    setLocalStream(localStream);
    setCameraEnabled(Boolean(cameraTrack && cameraTrack.enabled));
  };

  const toggleMic = async () => {
    const stream = localStreamRef.current || localStream;
    if (!stream) return;

    let audioTrack = stream.getAudioTracks()[0];
    if (audioTrack && audioTrack.readyState === "ended") {
      stream.removeTrack(audioTrack);
      audioTrack = null;
    }

    if (!audioTrack) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) {
          stream.addTrack(audioTrack);
          setLocalStream(stream);
          localStreamRef.current = stream;
          attachLocalAudioTrackToPeers(audioTrack, stream);
          setMicEnabled(true);
        }
      } catch (error) {
        console.error("Unable to enable microphone", error);
        setMicEnabled(false);
      }
      return;
    }

    const nextState = !audioTrack.enabled;
    audioTrack.enabled = nextState;
    setMicEnabled(nextState);
    if (nextState) {
      attachLocalAudioTrackToPeers(audioTrack, stream);
    }
  };

  const toggleCamera = async () => {
    const stream = localStreamRef.current || localStream || new MediaStream();
    const currentTrack = cameraTrackRef.current || stream.getVideoTracks()[0];
    if (cameraEnabled && currentTrack) {
      stream.removeTrack(currentTrack);
      currentTrack.stop();
      cameraTrackRef.current = null;
      setCameraEnabled(false);
      const nextStream = new MediaStream(stream.getTracks());
      setLocalStream(nextStream);
      localStreamRef.current = nextStream;
      socketRef.current?.emit("participant-media-state", {
        roomId: requestedRoomId || roomId,
        videoEnabled: false,
        micEnabled,
      });
      return;
    }
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
      const nextTrack = cameraStream.getVideoTracks()[0];
      if (!nextTrack) return;
      stream.addTrack(nextTrack);
      Object.values(peersRef.current || {}).forEach((peer) => {
        if (!peer?.destroyed && typeof peer.addTrack === "function")
          peer.addTrack(nextTrack, stream);
      });
      cameraTrackRef.current = nextTrack;
      attachCameraEndedListener(nextTrack);
      setCameraEnabled(true);
      const nextStream = new MediaStream(stream.getTracks());
      setLocalStream(nextStream);
      localStreamRef.current = nextStream;
      requestAnimationFrame(() => {
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = nextStream;
          localVideoRef.current.play?.().catch(() => {});
        }
      });
      socketRef.current?.emit("participant-media-state", {
        roomId: requestedRoomId || roomId,
        videoEnabled: true,
        micEnabled,
      });
    } catch (error) {
      console.error("Unable to acquire camera track", error);
    }
  };

  const toggleScreenShare = async () => {
    if (!localStream) return;

    if (screenSharing) {
      const screenTrack = screenShareStreamRef.current?.getVideoTracks()[0];
      if (screenTrack) {
        screenTrack.stop();
      }
      if (screenShareStreamRef.current) {
        screenShareStreamRef.current
          .getTracks()
          .forEach((track) => track.stop());
      }
      screenShareStreamRef.current = null;
      await restoreCameraTrack();
      setScreenSharing(false);
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) return;

      localStream.getVideoTracks().forEach((track) => {
        if (track !== cameraTrackRef.current) {
          localStream.removeTrack(track);
        }
      });
      if (
        cameraTrackRef.current &&
        localStream.getVideoTracks().includes(cameraTrackRef.current)
      ) {
        localStream.removeTrack(cameraTrackRef.current);
      }

      localStream.addTrack(screenTrack);
      screenShareStreamRef.current = screenStream;
      screenTrack.addEventListener("ended", async () => {
        await restoreCameraTrack();
        setScreenSharing(false);
      });
      setScreenSharing(true);
    } catch (error) {
      console.error("Unable to share screen", error);
    }
  };

  const endMeeting = () => {
    Object.values(peersRef.current).forEach((peer) => peer.destroy());
    peersRef.current = {};
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (screenShareStreamRef.current) {
      screenShareStreamRef.current.getTracks().forEach((track) => track.stop());
      screenShareStreamRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setLocalStream(null);
    setRemoteStreams({});
    setChatMessages([]);
    setJoined(false);
    setJoinError("");
    navigate("/");
  };

  const toggleChatPanel = () => {
    setShowChat((visible) => {
      const nextVisible = !visible;
      if (nextVisible) {
        setApprovalDrawerOpen(false);
      }
      return nextVisible;
    });
  };

  const openApprovalDrawer = () => {
    setApprovalDrawerOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setShowChat(false);
      }
      return nextOpen;
    });
  };

  const toggleFullscreen = (id) => {
    setFullscreenId((prev) => (prev === id ? null : id));
  };

  const sendChatMessage = (event) => {
    event.preventDefault();
    const trimmed = newMessage.trim();
    if (!trimmed || !socketRef.current) return;

    socketRef.current.emit("chat-message", {
      roomId: requestedRoomId || roomId,
      sender: user?.id || "guest",
      displayName: user?.displayName || "Guest",
      text: trimmed,
    });

    setNewMessage("");
    setShowChat(true);
    chatInputRef.current?.focus();
  };

  const openCreateHuddle = (mode) => {
    setHuddle(null);
    setGeneratedHuddle(null);
    setHuddleForm((previous) => ({
      ...previous,
      hostEmail: user?.email || "",
    }));
    setHuddleMode(mode);
    setShowCreateMenu(false);
    navigate("/create-huddle");
  };

  const MicOnIcon = () => (
    <svg
      viewBox="0 -960 960 960"
      width="24"
      height="24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-200Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Zm68.5-371.5Q520-503 520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480q17 0 28.5-11.5Z" />
    </svg>
  );

  const MicOffIcon = () => (
    <svg
      viewBox="0 -960 960 960"
      width="24"
      height="24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m710-362-58-58q14-23 21-48t7-52h80q0 44-13 83.5T710-362ZM480-594Zm112 112-72-72v-206q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v126l-80-80v-46q0-50 35-85t85-35q50 0 85 35t35 85v240q0 11-2.5 20t-5.5 18ZM440-120v-123q-104-14-172-93t-68-184h80q0 83 57.5 141.5T480-320q34 0 64.5-10.5T600-360l57 57q-29 23-63.5 39T520-243v123h-80Zm352 64L56-792l56-56 736 736-56 56Z" />
    </svg>
  );

  const CameraOnIcon = () => (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 6.75A2.75 2.75 0 0 1 6.75 4h6.5A2.75 2.75 0 0 1 16 6.75v1.13l3.28-2.32A1 1 0 0 1 21 6.41v11.18a1 1 0 0 1-1.72.69L16 15.12v1.13A2.75 2.75 0 0 1 13.25 19h-6.5A2.75 2.75 0 0 1 4 16.25z" />
    </svg>
  );

  const CameraOffIcon = () => (
    <svg
      viewBox="0 -960 960 960"
      width="24"
      height="24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M880-260 720-420v67l-80-80v-287H353l-80-80h367q33 0 56.5 23.5T720-720v180l160-160v440ZM822-26 26-822l56-56L878-82l-56 56ZM497-577ZM384-464ZM160-800l80 80h-80v480h480v-80l80 80q0 33-23.5 56.5T640-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Zm80 480v-22q0-44 44-71t116-27q72 0 116 27t44 71v22H240Z" />
    </svg>
  );

  const ScreenShareOnIcon = () => (
    <svg
      viewBox="0 -960 960 960"
      width="24"
      height="24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Zm280-200h320v-240H440v240Zm80-80v-80h160v80H520Z" />
    </svg>
  );

  const ScreenShareOffIcon = () => (
    <svg
      viewBox="0 -960 960 960"
      width="24"
      height="24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Zm280-200h320v-240H440v240Zm80-80v-80h160v80H520Z" />
    </svg>
  );

  const FullscreenIcon = () => (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M7 14H5v5h5v-2H7v-3zm10 5h-3v2h5v-5h-2v3zM7 5h3V3H5v5h2V5zm10 0v3h2V3h-5v2h3z" />
    </svg>
  );

  const ExitFullscreenIcon = () => (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M7 16H5v3h3v-2H7v-1zm10-8h1V7h-3v2h2v1zM7 8h2V6H5v3h2V8zm10 8v1h1v-3h-3v2h2z" />
    </svg>
  );

  const EndCallIcon = () => (
    <img
      src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAF9UlEQVR4AeycAZaUOhBF+/+V6E50J7oSx5XoX4nuRHcy/11O0h1CQxIgFMyUhxIakqrUu6mQnvH4783/mCrgAEzlv90cgAMwVsA4vFeAAzBWwDi8V4ADMFbAOLxXgAMwVsA4/PusAGPR0/AOIFXD4NoBGIiehnQAqRoG1w7AQPQ0pANI1TC4dgAGoqchHUCqhsG1AzAQPQ3pAFI1DK4dgIHoacgDAaRh/Toq4ACiEkZnB2AkfAzrAKISRmcHYCR8DOsAohJGZwdgJHwM6wCiEkZnB2AkfAzrAKISRmcH0Fn4kvvTAnh9ff0g+yT7FuyXztgfnTGd7gefo9EG+6GnX2T4+FQSwur5KQBIJMSOQiPkqwT5I/slewmGiNgHfcZ0uh98jkYb7Iue/pDhAyD4xQYwun+KwwyARGd2IjpCY1FohOwhDn6xAYzic5gDORSAMo4znRnO7ER0ROkheI1PYkcgEQbVU9N3lzbdAWSix5m+y+B3dhJhxOWK6uTezmHG7roBCMIzy88s+liNxyeEpzqBwTujW1XsDiATnvJ+pHW9K0CQQzcQuwEIwrPjYMYz6OvJvTxicgIE7wrALLeufLoZQBD+m+Ih/N6l+ld+f8pYDrCvuv4c7OM/+qPrj8Hifdpg9MN+6/meB+IDgpw3+90EQOIjOMIjzubByAGC4+uztOVA5K+6+B7sp86/g9H2puu/weJ92mD0wwADJM743gMIEF6UP9VAZWjo645VABSY7STLDbYu8qMXoqSCI/Y2kR6+h6sEEL4BEYFQKUOblX8Bgpc0xnWzm2YAEj/Oes7NAfMOEgdRdhU8j5F/Vkyqhophicofr/lMFbAsNUNoAiDxWff2mPVrkjx7H8QHAhpVj7UagMRHeJaLaufvsCEQeDdUQygCkPBxvW9dclhWWGuvzoF3xvDCb0gECLygAbLYbREA4qs3u5wW8RnssPtgrVX/Sx/KgYkEhNbqR3yWJM6zGswCSMSf7fzkwYsGzNZxr5fbkxDH31JOvLS/KzIV3QIC8RchPAWwQnxmPVtJBqlxvs0jA0HONYkuQpgAWCE+2zlmPaVaM6DLtwGEkmBZ2gxhAkCO2e3oVHWw5DCQqsZvqVECoXZJGioh12AEQLOfHx/TMG+Xf4Z8cckJ/vK+l/qsHGa3lECQsexWQ8j9jQA0KIP42ZLz6K0gcevKN8THg2teFbeUAQIv6JoMRzvKHEDN7CfI7KyQ+ARo3bri08qo5lJsdGE3M5u3HCw90+P7MYqXA/jv3mz5gl+os1yNWkl8BtHyDjnDdnUkyCih8QcgkDc5jp4ob7SorfaRxiMAKiUEqV3PGAyBbxpAXHJq+5IAe+utP43Ez1ZjDC0QWJLuk0y5c10rPjvG0dI9AhAygVCtkBECg2DpCS6KJxIm8WLD3g006RgLOznOteH4x178qKElb8QnzijGBEAYUBMEeaQ8dao6+GXJqb43hJwRp3bikSg51066p+LjZAKAm2FALRDoVmN8bzjFzM8HS86yli1l7mLu86z4dHgKgAcaDCW5FwR8sXUlQdyf1pQ3Y2RLyZi3jpNqp7Jm/cwCoIcGw4uSAbWUJl1TYwacaslJB/fsmrx1H+G25I34xWpfBKBBDIcGtBYCSw6JDH6u9Jdy3jL5qsRHjyoANNSAWiBQvpdYcshtyULes0vSk77V4tO3GgCNw2BKZXm5JYfclkx5DxNKbUq5N4kvf+3/fb0Gs1QJl11yEGPJlHdpSSL34pqfx2iqgNhZgwECZck3Z77ZMTN40XI/NnuT55ncVy+3qwCgrAbCjIi/++Xf9lCmPHrz9iR3JuGqvFcDWBXNO00UcAATSY694QCO1XsSzQFMJDn2hgM4Vu9JNAcwkeTYG9cEcKxGXaM5gK7ylp07gLJGXVs4gK7ylp07gLJGXVs4gK7ylp07gLJGXVs4gK7ylp07gLJGXVs4gK7ylp07gLJGXVs0AOg6jnfr3AEYo3cADsBYAePwXgEOwFgB4/BeAQ7AWAHj8F4BDsBYAePwXgEFAL0f/w8AAP//SHtcdgAAAAZJREFUAwAXxDXfWVc3JwAAAABJRU5ErkJggg=="
      width="24"
      height="24"
      alt="End call"
      style={{ display: "block" }}
    />
  );

  const MessageIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      height="24px"
      viewBox="0 -960 960 960"
      width="24px"
      fill="#FFFFFF"
    >
      <path d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z" />
    </svg>
  );

  const UnreadMessageIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      height="24px"
      viewBox="0 -960 960 960"
      width="24px"
      fill="#FFFFFF"
    >
      <path d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-4q-37-8-67.5-27.5T600-720H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h404q-4 20-4 40t4 40H160v525l46-45h594v-324q23-5 43-13.5t37-22.5v360q0 33-23.5 56.5T800-240H240L80-80Zm80-720v480-480Zm515 45q-35-35-35-85t35-85q35-35 85-35t85 35q35 35 35 85t-35 85q-35 35-85 35t-85-35Z" />
    </svg>
  );

  const MuteParticipantIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      height="24px"
      viewBox="0 -960 960 960"
      width="24px"
      fill="#FFFFFF"
    >
      <path d="M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z" />
    </svg>
  );

  const MutedParticipantIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      height="24px"
      viewBox="0 -960 960 960"
      width="24px"
      fill="#FFFFFF"
    >
      <path d="M792-56 671-177q-25 16-53 27.5T560-131v-82q14-5 27.5-10t25.5-12L480-368v208L280-360H120v-240h128L56-792l56-56 736 736-56 56Zm-8-232-58-58q17-31 25.5-65t8.5-70q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 53-14.5 102T784-288ZM650-422l-90-90v-130q47 22 73.5 66t26.5 96q0 15-2.5 29.5T650-422ZM480-592 376-696l104-104v208Zm-80 238v-94l-72-72H200v80h114l86 86Zm-36-130Z" />
    </svg>
  );

  const PinParticipantIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      height="24px"
      viewBox="0 -960 960 960"
      width="24px"
      fill="#FFFFFF"
    >
      <path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z" />
    </svg>
  );

  const UnpinParticipantIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      height="24px"
      viewBox="0 -960 960 960"
      width="24px"
      fill="#FFFFFF"
    >
      <path d="M680-840v80h-40v327l-80-80v-247H400v87l-87-87-33-33v-47h400ZM480-40l-40-40v-240H240v-80l80-80v-46L56-792l56-56 736 736-58 56-264-264h-6v240l-40 40ZM354-400h92l-44-44-2-2-46 46Zm126-193Zm-78 149Z" />
    </svg>
  );

  const KickParticipantIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      height="24px"
      viewBox="0 -960 960 960"
      width="24px"
      fill="#FFFFFF"
    >
      <path d="M791-55 686-160H160v-112q0-34 17.5-62.5T224-378q45-23 91.5-37t94.5-21L55-791l57-57 736 736-57 57ZM240-240h366L486-360h-6q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm496-138q29 14 46 42.5t18 61.5L666-408q18 7 35.5 14t34.5 16ZM568-506l-59-59q23-9 37-29.5t14-45.5q0-33-23.5-56.5T480-720q-25 0-45.5 14T405-669l-59-59q23-34 58-53t76-19q66 0 113 47t47 113q0 41-19 76t-53 58Zm38 266H240h366ZM457-617Z" />
    </svg>
  );

  return (
    <div
      className={`app-shell ${theme} ${isMeetingRoute ? "meeting-shell" : ""}`}
    >
      {!isMeetingRoute && (
        <header className="topbar">
          <div
            className="topbar-brand"
            role="button"
            tabIndex={0}
            onClick={() => navigate("/")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                navigate("/");
              }
            }}
          >
            <div className="topbar-logo" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 -960 960 960"
                fill="#8C1AF6"
              >
                <path d="M344-65.67q-47.33 0-84.17-27-36.83-27-53.5-71-16 24.34-39.5 37.84-23.5 13.5-53.5 13.5-48.33 0-80.5-33.67Q.67-179.67.67-226.33q0-47 29.66-77.5 29.67-30.5 75.34-32.84-16.67-20-25.84-45.16-9.16-25.17-9.16-51.5 0-38.67 19.83-72.34 19.83-33.66 56.17-54.33 5 14.67 12.83 31.5t16.83 29.17q-18 12.33-28.33 30.16-10.33 17.84-10.33 37.5 0 58.67 47.66 73.34Q233-343.67 276.67-335l13.66 23.33q-11.66 34-19.33 56.5-7.67 22.5-7.67 41.17 0 32.67 24.17 57.17t57.17 24.5q40 0 66-34.34Q436.67-201 453-248t25.17-95q8.83-48 14.5-74.33l64.66 17.66q-9 43.67-21.33 101-12.33 57.34-35.17 109.17-22.83 51.83-60 87.83-37.16 36-96.83 36ZM114-179q19.67 0 33.17-13.5t13.5-33.17q0-19.66-13.5-33.16-13.5-13.5-33.17-13.5t-33.17 13.5q-13.5 13.5-13.5 33.16 0 19.67 13.5 33.17T114-179Zm294.67-179.33q-45.34-40.34-82.5-75.17-37.17-34.83-63.84-68-26.66-33.17-41.16-65.67-14.5-32.5-14.5-68.5 0-61.66 42.83-104.5Q292.33-783 354-783q7.33 0 13.67.5 6.33.5 13 1.83-7.34-14.66-10.67-26-3.33-11.33-3.33-23 0-47.33 33-80.33T480-943q47.33 0 80.33 33t33 80.33q0 11-3 22.5t-11 26.17q6.67-1.33 13-1.67 6.34-.33 13.67-.33 58 0 98.33 37.17 40.34 37.16 47 92.16-15.33-1.66-33.5-1.33-18.16.33-33.83 2.33-5.67-27.66-26.5-45.66-20.83-18-51.5-18-36.33 0-57.17 20.5-20.83 20.5-56.16 61.5h-26.34q-36.33-43-57.16-62.5-20.84-19.5-55.17-19.5-34.67 0-57.67 23t-23 57.66q0 23.67 13 48.5 13 24.84 36.84 53Q347-506 380.83-474.67q33.84 31.34 75.5 68.67l-47.66 47.67Zm104.5-438.17q13.5-13.5 13.5-33.17 0-19.66-13.5-33.16-13.5-13.5-33.17-13.5t-33.17 13.5q-13.5 13.5-13.5 33.16 0 19.67 13.5 33.17T480-783q19.67 0 33.17-13.5ZM615-65q-22 0-43.5-6.67Q550-78.33 530-92q9-12.67 18-29t15.33-30.33q13 9.66 26.34 14.33 13.33 4.67 27 4.67 34 0 57.5-24.5t23.5-57.5q0-19.67-8-42-8-22.34-19-55.67l13.66-23.33q44.67-8 91.84-22.67 47.16-14.67 47.16-73.33 0-42.67-31.16-63-31.17-20.34-68.84-20.34-42 0-99 16t-132.66 41l-17-64.66q76.66-25 137.66-42t111.34-17q65.66 0 116 39.33Q890-502.67 890-432q0 26.33-9.17 51.17Q871.67-356 855-336q45 2.33 75 33.17 30 30.83 30 77.16 0 46.67-32.17 80.34-32.16 33.66-80.5 33.66-29.33 0-53.5-13.5-24.16-13.5-39.5-37.83-17.33 44-54.16 71Q663.33-65 615-65Zm265-126.83q13.33-13.5 13.33-33.17 0-19-13.83-33.33-13.83-14.34-32.83-14.34t-32.84 13.84Q800-245 800-226t14.33 33.33q14.34 14.34 33.34 14.34 19 0 32.33-13.5Zm-766-33.84Zm366-604ZM846.67-226Z" />
              </svg>
            </div>
            <div>
              <h1
                className="bebas-neue-regular"
                style={{
                  fontFamily: "sans-serif",
                  fontStyle: "normal",
                  fontWeight: "bold",
                }}
              >
                HUDDLE NOW
              </h1>
              {/* <p>Smart vi1deo conferencing for teams and creators</p> */}
            </div>
          </div>
          <div className="topbar-actions">
            {showApprovalButton ? (
              <Badge
                color="error"
                variant="dot"
                invisible={pendingApprovalCount === 0 || approvalDrawerOpen}
                sx={{ mr: 1.5 }}
              >
                <button
                  type="button"
                  className="topbar-avatar"
                  onClick={openApprovalDrawer}
                  aria-label="Open approval requests"
                  data-approval-trigger="true"
                >
                  <NotificationsNoneRoundedIcon fontSize="small" />
                </button>
              </Badge>
            ) : null}
            {user ? (
              <Avatar
                className="topbar-avatar"
                onClick={() => navigate("/profile")}
                aria-label="Open user profile"
                micLevel={speakingLevels.local || 0}
                style={{ cursor: "pointer" }}
                src={user.picture}
                alt={user.displayName || "User avatar"}
              >
                {(user.displayName || "Guest").charAt(0)}
              </Avatar>
            ) : null}
          </div>
        </header>
      )}

      <aside
        ref={approvalDrawerRef}
        className={`approval-sidebar ${approvalDrawerOpen ? "open" : ""}`}
        aria-hidden={!approvalDrawerOpen}
      >
        <div className="approval-sidebar-content">
          <div className="approval-sidebar-header">
            <div>
              <h2 className="approval-sidebar-title">Approval requests</h2>
              <p className="approval-sidebar-description">
                Review private-room join requests here.
              </p>
            </div>
          </div>
          <div className="approval-sidebar-body">
            {approvalRequests.filter((request) => request.status === "pending")
              .length === 0 ? (
              <div className="approval-sidebar-empty">
                <p>No pending requests.</p>
              </div>
            ) : (
              approvalRequests
                .filter((request) => request.status === "pending")
                .map((request) => (
                  <div key={request.id} className="approval-sidebar-item">
                    <div className="approval-request-user">
                      <div className="approval-request-avatar">
                        {request.guestAvatar ? (
                          <Avatar
                            className="approval-request-avatar"
                            src={request.guestAvatar}
                            alt={request.guestName}
                            size={48}
                          />
                        ) : (
                          <span>
                            {(request.guestName || "G").charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="approval-request-details">
                        <div className="approval-request-name">
                          {request.guestName}
                        </div>
                      </div>
                    </div>
                    <div className="approval-request-actions">
                      <button
                        type="button"
                        className="approval-request-action approval-request-approve"
                        onClick={() => respondToApprovalRequest(request, true)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="approval-request-action approval-request-decline"
                        onClick={() => respondToApprovalRequest(request, false)}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </aside>

      {joinDeclineModalOpen ? (
        <div className="join-decline-modal" role="dialog" aria-modal="true">
          <div className="join-decline-modal-card">
            <h3>Join request declined</h3>
            <p>{joinDeclineMessage || "Host declined your join request."}</p>
            <Button
              variant="contained"
              onClick={() => {
                setJoinDeclineModalOpen(false);
                setJoinDeclineMessage("");
              }}
            >
              Close
            </Button>
          </div>
        </div>
      ) : null}

      {(showSigningInLoader || showJoiningLoader) && (
        <div className="blur-overlay loader-overlay" aria-hidden>
          <div className="loader-card">
            <div className="loader-message">
              {showSigningInLoader ? "Signing in..." : "Joining meeting..."}
            </div>
            <div className="three-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}

      <main className="main-content">
        {isMeetingRoute ? (
          <section className="meeting-area">
            {/* Host badge */}
            {(() => {
              let hostName = null;
              if (huddle?.hostEmail) {
                const found = Object.values(participants).find(
                  (p) => p.email === huddle.hostEmail,
                );
                if (found) hostName = found.displayName || found.email;
                else if (user?.email === huddle.hostEmail)
                  hostName = user.displayName;
                else hostName = huddle.hostEmail;
              } else if (huddle?.ownerId) {
                const p = participants[huddle.ownerId];
                if (p) hostName = p.displayName || p.email;
              }
              return hostName ? (
                <div className="host-badge">Host: {hostName}</div>
              ) : null;
            })()}

            {/* Floating reactions overlay */}
            <div className="reaction-overlay" aria-hidden>
              {reactions.map((r) => (
                <div
                  key={r.id}
                  className="reaction-float"
                  style={{ left: `${r.left}%` }}
                >
                  <span className="reaction-emoji">{r.emoji}</span>
                  <span className="reaction-name">{r.displayName}</span>
                </div>
              ))}
            </div>

            <section className="meeting-stage">
              <div className="meeting-main">
                <div className="video-grid">
                  {localStream ? (
                    <article
                      className={`video-tile ${fullscreenId === "local" ? "fullscreen" : ""} ${localHasVideo ? "has-video" : "no-video"} ${speakingParticipants.local ? "speaking" : ""}`}
                      style={{ "--mic-level": speakingLevels.local || 0 }}
                    >
                      {localHasVideo ? (
                        <video autoPlay playsInline muted ref={localVideoRef} />
                      ) : (
                        <div className="video-placeholder">
                          {user?.picture ? (
                            <Avatar
                              className="video-placeholder-avatar"
                              src={user.picture}
                              alt={user.displayName || "You"}
                              size={96}
                              micLevel={speakingLevels?.local || 0}
                              style={{
                                "--mic-level": speakingLevels?.local || 0,
                              }}
                              imgProps={{ referrerPolicy: "no-referrer" }}
                            />
                          ) : (
                            <span>{localInitial}</span>
                          )}
                        </div>
                      )}
                      <div className="video-time-badge">
                        {now.toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      {localHasVideo ? (
                        <div className="video-controls-overlay">
                          <button
                            type="button"
                            className="fullscreen-toggle"
                            onClick={() => toggleFullscreen("local")}
                            aria-label="Toggle fullscreen"
                          >
                            {fullscreenId === "local" ? (
                              <ExitFullscreenIcon />
                            ) : (
                              <FullscreenIcon />
                            )}
                          </button>
                        </div>
                      ) : null}
                      <div className="video-label">
                        You • {user?.displayName || "Guest"}
                      </div>
                    </article>
                  ) : null}
                  {Object.entries(remoteStreams).map(([socketId, stream]) => {
                    const participantHasVideo = Boolean(
                      participants[socketId]?.videoEnabled &&
                      stream &&
                      stream.getVideoTracks().length,
                    );
                    const participantInitial = getParticipantInitial(socketId);
                    return (
                      <article
                        key={socketId}
                        className={`video-tile ${fullscreenId === socketId ? "fullscreen" : ""} ${participantHasVideo ? "has-video" : "no-video"} ${speakingParticipants[socketId] ? "speaking" : ""}`}
                        style={{ "--mic-level": speakingLevels[socketId] || 0 }}
                      >
                        {participantHasVideo ? (
                          <video
                            autoPlay
                            playsInline
                            ref={(element) => {
                              if (element) {
                                remoteVideoRefs.current[socketId] = element;
                              }
                            }}
                          />
                        ) : (
                          <NoVideoTile
                            participant={participants[socketId]}
                            fallbackName={participantInitial}
                          />
                        )}
                        <div className="video-time-badge">
                          {now.toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        {participantHasVideo ? (
                          <div className="video-controls-overlay">
                            <button
                              type="button"
                              className="fullscreen-toggle"
                              onClick={() => toggleFullscreen(socketId)}
                              aria-label="Toggle fullscreen"
                            >
                              {fullscreenId === socketId ? (
                                <ExitFullscreenIcon />
                              ) : (
                                <FullscreenIcon />
                              )}
                            </button>
                          </div>
                        ) : null}
                        <div className="video-label">
                          {participants[socketId]?.displayName
                            ? participants[socketId].displayName.split(" ")[0]
                            : `Guest ${socketId.slice(0, 6)}`}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="sidebar-panel">
                <div className="meeting-chat-overlay">
                  <aside
                    ref={chatPanelRef}
                    className={`meeting-chat ${showChat ? "open" : ""}`}
                    aria-hidden={!showChat}
                  >
                    <div className="meeting-chat-header">
                      <div>
                        <h3>Meeting chat</h3>
                        <p>
                          {joined
                            ? "Live conversation for this room"
                            : "Connecting to your meeting room…"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="chat-close-button"
                        onClick={() => setShowChat(false)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="meeting-chat-messages">
                      {chatMessages.length > 0 ? (
                        chatMessages.map((message) => {
                          const isSelf =
                            message.sender === (user?.id || "guest");
                          return (
                            <div
                              key={message.id}
                              className={`chat-bubble ${isSelf ? "self" : "peer"}`}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                              }}
                            >
                              <span className="chat-author">
                                {message.displayName}
                              </span>
                              <p style={{ margin: 0 }}>{message.text}</p>
                            </div>
                          );
                        })
                      ) : (
                        <div className="chat-empty-state">
                          Start the conversation here. Messages stay in this
                          meeting room only.
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                    <form
                      className="meeting-chat-form"
                      onSubmit={sendChatMessage}
                    >
                      <input
                        ref={chatInputRef}
                        value={newMessage}
                        onChange={(event) => setNewMessage(event.target.value)}
                        placeholder="Type a message"
                        aria-label="Type a meeting message"
                        autofocus
                      />
                      <button type="submit">Send</button>
                    </form>
                  </aside>
                </div>

                <aside className="participant-sidebar">
                  <div className="participant-sidebar-header">
                    <h3>Room participants</h3>
                  </div>
                  <div className="participant-list">
                    <div className="participant-item self-participant">
                      <span className="participant-indicator self" />
                      <span>{user?.displayName || "You"}</span>
                    </div>
                    {Object.keys(participants).length > 0 ? (
                      Object.entries(participants)
                        .sort(([idA], [idB]) => {
                          const aIsPinned = pinnedParticipantId === idA;
                          const bIsPinned = pinnedParticipantId === idB;
                          return aIsPinned ? -1 : bIsPinned ? 1 : 0;
                        })
                        .map(([socketId, p]) => (
                          <div
                            key={socketId}
                            className={`participant-item${pinnedParticipantId === socketId ? " pinned" : ""}`}
                          >
                            {p?.avatar ? (
                              <Avatar
                                className="participant-avatar"
                                src={p.avatar}
                                alt={p.displayName}
                                size={40}
                                micLevel={speakingLevels?.[socketId] || 0}
                              />
                            ) : (
                              <div className="participant-avatar initials">
                                {(p?.displayName || "G").charAt(0)}
                              </div>
                            )}
                            <span>
                              {
                                (
                                  p?.displayName ||
                                  `Guest ${socketId.slice(0, 6)}`
                                ).split(" ")[0]
                              }
                            </span>
                            <div className="participant-actions">
                              <button
                                className="participant-action-btn"
                                onClick={() => toggleParticipantMute(socketId)}
                                title={
                                  mutedParticipantIds[socketId]
                                    ? "Unmute participant"
                                    : "Mute participant"
                                }
                                aria-label={
                                  mutedParticipantIds[socketId]
                                    ? "Unmute participant"
                                    : "Mute participant"
                                }
                              >
                                {mutedParticipantIds[socketId] ? (
                                  <MutedParticipantIcon />
                                ) : (
                                  <MuteParticipantIcon />
                                )}
                              </button>
                              <button
                                className="participant-action-btn"
                                onClick={() => toggleParticipantPin(socketId)}
                                title={
                                  pinnedParticipantId === socketId
                                    ? "Unpin participant"
                                    : "Pin participant"
                                }
                                aria-label={
                                  pinnedParticipantId === socketId
                                    ? "Unpin participant"
                                    : "Pin participant"
                                }
                              >
                                {pinnedParticipantId === socketId ? (
                                  <UnpinParticipantIcon />
                                ) : (
                                  <PinParticipantIcon />
                                )}
                              </button>
                              {canManageParticipants &&
                              socketId !== socketRef.current?.id ? (
                                <button
                                  className="participant-action-btn kick-btn"
                                  onClick={() => performKick(socketId)}
                                  title="Kick participant"
                                  aria-label="Kick participant"
                                >
                                  <KickParticipantIcon />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))
                    ) : (
                      <div className="participant-empty">
                        Only you are in the room.
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </section>

            <div className="controls-bar">
              <button
                type="button"
                className={`control-button ${micEnabled ? "active" : ""}`}
                onClick={toggleMic}
              >
                <span className="control-icon" aria-hidden="true">
                  {micEnabled ? <MicOnIcon /> : <MicOffIcon />}
                </span>
                <span>{micEnabled ? "Mic On" : "Mic Off"}</span>
              </button>
              {kicked ? (
                <div className="kicked-modal">
                  <div className="kicked-box">
                    <h3>You have been kicked out from the huddle</h3>
                    <p>If you believe this was a mistake, contact the host.</p>
                    <button
                      onClick={() => {
                        window.location.href = "/";
                      }}
                    >
                      Return to home
                    </button>
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className={`control-button ${cameraEnabled ? "active" : ""}`}
                onClick={toggleCamera}
              >
                <span className="control-icon" aria-hidden="true">
                  {cameraEnabled ? <CameraOnIcon /> : <CameraOffIcon />}
                </span>
                <span>{cameraEnabled ? "Camera On" : "Camera Off"}</span>
              </button>
              <button
                type="button"
                className={`control-button ${screenSharing ? "active" : ""}`}
                onClick={toggleScreenShare}
              >
                <span className="control-icon" aria-hidden="true">
                  {screenSharing ? (
                    <ScreenShareOnIcon />
                  ) : (
                    <ScreenShareOffIcon />
                  )}
                </span>
                <span>{screenSharing ? "Screening On" : "Screening Off"}</span>
              </button>

              <button
                type="button"
                className={`control-button ${handRaised ? "active" : ""}`}
                onClick={toggleHandRaise}
              >
                <span className="control-icon" aria-hidden="true">
                  <img
                    src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAGyUlEQVR4Aeyci5XTMBBFEypZKmGpBKhkl0qASoBKWCoJ7/rIIXEkS7IlS05mjyeK9Z15b2ak/Pbdwf6aImAENIX/cDACjIDGCDRefpcRcDqdniTfJFx/9PBT8tQYy0XL744AB/QfWftZwgXwz3qySxJ2R4CAfpH4Loj45mvouW6PBODtIUwhIdTWZf0eCZgDea7tTABpTNLFHrJHAs5ALnki4CGpmz3k4QgQaS8HPXguiNl8D3lEArraQ5oQQBqQtMrBeLonAIaqubahQ+mHzQkQ8BjZTQ4uDWjufJsTIAXv6hwve1ZdLQjoKgevQq/A4BYEkIJCqs+1hcZsXk8alRTZw1oQsDlgJRcU8DhJsT3MCMhnp+geZgTkE1B0DzMC8gkgBYVGzbV5x2xIgHf9h680Ahq7gBFgBDRGoPHyFgFGQGMEGi9vEWAENEag8fIWAUZAYwQaL28RUJmA2PRGQAyhyu1GQGWAY9MbATGEKrcbAZUBjk1vBMQQqtxuBFQGODa9ERBDqHK7EVAZ4Nj0RkAMocrtRkBlgGPT3ycBMas7ajcCGpNhBOyBAL4PKXlxwpdSkfF3uo1N2Pfy0QgQ6Pxuii+jvspUBOARSOBX6qHvSqq7XTEEggQIeP4dAMADdmgevor3qr4QMdcvNP7h670ECFCABXzKFJDoR0RUj4Zj5C+mbGT4MTa+dLuXAC0C+CqyrzEaICR78CMOCBFArl+KB+DzjzOqR8NSBXsaFyLgh5R8kyy9IMGiIQE9LwHKk4D/MWF8rAtEWDTMoOQlgP6OhIxUxCivQIJFgxeaQ/R/xpGKfgXG5lZDxM/cQffePxgBGO6i4AvPCwkkFJrqPqaZJQATHQklUhHTmUwQiBLg+pdMRW5KK0AgiQAXBSVTEWubCIEkAtTvkElCqY2bpe9akglwKAAs4m6DBZstryN4PRHstLcG9x7ZnNrZ9mYRkBEFEPBJmkLCPW3g2CWzglddAlg2gwTenn5W/68ady8ktCdAYLIffFeZkor4FO3JkfA+cYy67edaq2lWCposlnIqwmP4RA3SCE/G7DkaPkwwmN5i47Ru9n4xAfJqFgPQ2QXU+KzNa3hrmjESUhLRwHg17+qa+08pGPKXhxxZTACLCMzUVPRZJBANDBujYY8b9NmGwZDbh5S0fDVqFQFuJqIg5s0ofvVGnMh7k+wmGuRAHCqcyf5C9sRwuBm4mgC3KEDeTD6p4EP+IRVd1rvxe4gGjtWXqk+fkw2mddH71QSwgkBkcYTbOSEV3eRRjR+jocsNWt6Pzsicbb/nGkNtRQhwkxMFsRAkFQ2nIjfmqhARzHFV18nNTeRO9ZLuKQ44HRb9QOZmQKhCCgA++0Goy1hPKgqSMHbqpZT3k/tj3r8IfGwsGQGcbjgFpKQRjqYxo9CvB4nlfnTk7XrKbClKgFsdZYgGd+sthlQk76L0duihUvqRemKO8kvRj+MtUrk4AVIG8JNSkTS+OprqPu3aoJfAB/iUaF61bxUnAGxEAh6RonyX+4EDP8U5vjtbMXuRVCHAaUIqggh3Gyw4mnazKQt80mIK+Bi0yvuZoBoB8ozUVIQekEC+5XkzEfikndTvxb46G1fpW40AtHIKpuwHdOfLW3yLDg/kflMR+Bw3Uz2fjXe192NgVQJYQCRwRk7ZD+iOB0LCptEg8FkvNQ3yqp23TtB3tVQnAA1FAt6SSgIRQDQACsOriYDn9QgpJ1U3dEmNaPpGZRMCnBapm7LrfoAEfnkzfKo2VpYoBTynL9INAuGp036UM6UcLFLnK/dWRGxFKT5uyjkGAA7eCREIeTq2lLfdgQ6ZgI7Xk+68fQOVX2RDju6Baa6rt4wA3qoYSaC81iR+Bxn8DAoiKBFOT8gZTAc0Hk56oQ3QARyBzHPf+JJDD3TF89nLhoqSD5sSgOLyosEgPQcMFdkXRBAJCBsnwsYt7E8nzQbQCJ5OG+swRk3Z16CrdC7u+aMmGQSMQ9aXMoiTBBszpwmMXD9p+Rk4ar5H1/JT/5+xCQHj8jIOz4IEvHSs7qHkRRZ6VdelKQFYJxLGaOiBBBwCryc6Ua+6NCdgtFBEYDRfV4GIrdMS6wE8my3PR7Wql90QgKUiYYgGlRBBCqhy8mAtJ3g8oAP+psC79bd7HTAumFqKBDZBXnVCBiVgpQ4P9QNkIowzvZY4An6JeUPrReu7igCftsfjkajgfXciAjIoIQQhQpBLEAEZoY42AEcAG0//qjmp9y23eV33BFwiIuAgg8iAEARPRgBXzcMFyAh1tAE4AiGX03XxfFcEdIFYYSWMgMKA5k5nBEQQq938DwAA//9rF91qAAAABklEQVQDAN4MLN9WrvhLAAAAAElFTkSuQmCC"
                    width="24"
                    height="24"
                    alt="Raise hand"
                    style={{ display: "block" }}
                  />
                </span>
                <span>{handRaised ? "Lower hand" : "Raise hand"}</span>
              </button>
              {showApprovalButton ? (
                <button
                  type="button"
                  className="control-button"
                  onClick={openApprovalDrawer}
                  data-approval-trigger="true"
                >
                  <span className="control-icon" aria-hidden="true">
                    <NotificationsNoneRoundedIcon />
                  </span>
                  <span>Request</span>
                </button>
              ) : null}
              <button
                type="button"
                className={`control-button ${showChat ? "active" : ""}`}
                onClick={toggleChatPanel}
                data-chat-trigger="true"
              >
                <span className="control-icon" aria-hidden="true">
                  {unreadChat ? <UnreadMessageIcon /> : <MessageIcon />}
                </span>
                <span>Chat</span>
              </button>
              <div className="emoji-reaction-wrapper">
                <button
                  type="button"
                  className={`control-button ${showEmojiMenu ? "active" : ""}`}
                  onClick={() => setShowEmojiMenu((s) => !s)}
                  aria-haspopup="menu"
                  aria-expanded={showEmojiMenu}
                >
                  <span className="control-icon" aria-hidden="true">
                    <img
                      src="data:image/png;base64,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"
                      width="24"
                      height="24"
                      alt="React"
                      style={{ display: "block" }}
                    />
                  </span>
                  <span>React</span>
                </button>
                {showEmojiMenu ? (
                  <div className="emoji-menu" role="menu">
                    {["👍🏻", "😆", "😥", "😯", "✅", "❌"].map((e) => (
                      <button
                        key={e}
                        type="button"
                        className="emoji-item"
                        onClick={() => handleSendEmoji(e)}
                        role="menuitem"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="control-button end-call-button"
                onClick={endMeeting}
              >
                <span className="control-icon" aria-hidden="true">
                  <img
                    src="data:image/png;base64,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"
                    width="24"
                    height="24"
                    alt="End call"
                    style={{ display: "block" }}
                  />
                </span>
                <span>End call</span>
              </button>
            </div>
          </section>
        ) : isProfileRoute ? (
          <section className="profile-page">
            <div className="profile-layout">
              <aside className="profile-sidebar">
                <div className="sidebar-header">
                  {profileForm.picture ? (
                    <img
                      src={profileForm.picture}
                      alt={profileForm.displayName || "Profile avatar"}
                      className="sidebar-avatar"
                    />
                  ) : (
                    <div className="sidebar-avatar initials">
                      {(profileForm.displayName || "U").charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="sidebar-label">Signed in as</p>
                    <strong>{profileForm.displayName || "Guest User"}</strong>
                  </div>
                </div>

                <nav className="profile-nav">
                  <button
                    type="button"
                    className={profileSection === "account" ? "active" : ""}
                    onClick={() => setProfileSection("account")}
                  >
                    Profile & Account
                  </button>
                  <button
                    type="button"
                    className={profileSection === "activity" ? "active" : ""}
                    onClick={() => setProfileSection("activity")}
                  >
                    Activity & History
                  </button>
                  <button
                    type="button"
                    className={profileSection === "audio" ? "active" : ""}
                    onClick={() => setProfileSection("audio")}
                  >
                    Audio & Video Settings
                  </button>
                  <button
                    type="button"
                    className={profileSection === "billing" ? "active" : ""}
                    onClick={() => setProfileSection("billing")}
                  >
                    Plan & Billing
                  </button>
                </nav>

                <div className="sidebar-footer">
                  <button
                    type="button"
                    className="sign-out-button"
                    onClick={handleSignOut}
                  >
                    Sign out
                    <span className="sign-out-icon" aria-hidden="true">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 -960 960 960"
                        width="24"
                        height="24"
                        fill="#8C1AF6"
                      >
                        <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z" />
                      </svg>
                    </span>
                  </button>
                </div>
              </aside>

              <div className="profile-content">
                {profileSection === "account" && (
                  <section className="profile-panel">
                    <div className="panel-header">
                      <h2>Profile & Account</h2>
                      <p>
                        Update your name, email, avatar, and password settings.
                      </p>
                    </div>
                    <div className="profile-card">
                      <div className="profile-avatar-card">
                        {profileForm.picture ? (
                          <img
                            src={profileForm.picture}
                            alt={profileForm.displayName || "Profile avatar"}
                            className="profile-avatar"
                          />
                        ) : (
                          <div className="profile-avatar initials">
                            {(profileForm.displayName || "U").charAt(0)}
                          </div>
                        )}
                        <div className="profile-actions">
                          <label className="upload-button">
                            Change photo
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleProfilePictureUpload}
                            />
                          </label>
                        </div>
                      </div>
                      <form
                        className="profile-form"
                        onSubmit={saveProfileUpdates}
                      >
                        <label>
                          Display name
                          <input
                            value={profileForm.displayName}
                            onChange={(event) =>
                              setProfileForm({
                                ...profileForm,
                                displayName: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Email address
                          <input
                            type="email"
                            value={profileForm.email}
                            onChange={(event) =>
                              setProfileForm({
                                ...profileForm,
                                email: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Password reset
                          <button type="button" className="ghost-button">
                            Reset password
                          </button>
                        </label>
                        <div className="form-actions">
                          <button type="button" onClick={() => navigate(-1)}>
                            Back
                          </button>
                          <button type="submit">Save changes</button>
                        </div>
                      </form>
                    </div>
                  </section>
                )}

                {profileSection === "activity" && (
                  <section className="profile-panel">
                    <div className="panel-header">
                      <h2>Activity & History</h2>
                      <p>
                        Review your hosted events, attendance, and meeting
                        history.
                      </p>
                    </div>
                    <div className="activity-metrics">
                      <div>
                        <strong>{activityMetrics.hosted}</strong>
                        <span>Huddles hosted</span>
                      </div>
                      <div>
                        <strong>{activityMetrics.joined}</strong>
                        <span>Huddles joined</span>
                      </div>
                      <div>
                        <strong>{activityMetrics.attendees}</strong>
                        <span>Attendees</span>
                      </div>
                    </div>
                    <section className="upcoming-meets">
                      <h3>Past meetings</h3>
                      {upcomingMeets.length > 0 ? (
                        upcomingMeets.map((meet) => (
                          <article key={meet.id} className="upcoming-meet-card">
                            <strong>{meet.title}</strong>
                            <span>{meet.scheduledAt}</span>
                            <p>{meet.purpose}</p>
                          </article>
                        ))
                      ) : (
                        <div className="empty-state">
                          No past meetings recorded yet.
                        </div>
                      )}
                    </section>
                  </section>
                )}

                {profileSection === "audio" && (
                  <section className="profile-panel">
                    <div className="panel-header">
                      <h2>Audio & Video Settings</h2>
                      <p>
                        Test your mic, preview camera, and toggle blur effects.
                      </p>
                    </div>
                    <div className="settings-grid">
                      <div className="settings-card">
                        <h3>Microphone</h3>
                        <p>
                          Verify your audio input before joining the next
                          meeting.
                        </p>
                        <div
                          className={`mic-check-status ${micTestResult ? micTestResult : ""}`}
                        >
                          <span className="status-icon" aria-hidden="true">
                            {micTestResult === "ready"
                              ? "✔"
                              : micTestResult === "not-ready"
                                ? "✕"
                                : "●"}
                          </span>
                          <span className="status-message">
                            {micTestResult === "ready"
                              ? "Your mic is ready"
                              : micTestResult === "not-ready"
                                ? "Check your mic"
                                : "Press Test mic to verify your audio input"}
                          </span>
                        </div>
                        <div
                          className={`mic-waveform ${micTestRunning ? "active" : ""}`}
                        >
                          {micTestLevels.length > 0 ? (
                            micTestLevels.map((level, index) => (
                              <span
                                key={index}
                                style={{ height: `${level}%` }}
                                aria-hidden="true"
                              />
                            ))
                          ) : (
                            <>
                              {Array.from({ length: 10 }).map((_, index) => (
                                <span
                                  key={index}
                                  style={{
                                    height: micTestRunning
                                      ? `${20 + index * 4}%`
                                      : "18%",
                                  }}
                                  aria-hidden="true"
                                />
                              ))}
                            </>
                          )}
                        </div>
                        <div className="settings-card-bottom">
                          <button
                            type="button"
                            onClick={handleAudioTest}
                            className={`test-mic-button ${micTestRunning ? "running" : ""}`}
                          >
                            {micTestRunning
                              ? "Checking…"
                              : micTestResult === "ready"
                                ? "Passed"
                                : micTestResult === "not-ready"
                                  ? "Try again"
                                  : "Test mic"}
                          </button>
                          <p className="status-text">{audioTestMessage}</p>
                        </div>
                      </div>
                      <div className="settings-card">
                        <h3>Camera preview</h3>
                        <p>
                          Verify your camera input before joining the next
                          meeting.
                        </p>
                        <div className="camera-preview-wrapper">
                          <video
                            ref={profilePreviewRef}
                            autoPlay
                            playsInline
                            muted
                          />
                        </div>
                        <div
                          className={`mic-check-status ${cameraTestResult ? cameraTestResult : ""}`}
                        >
                          <span className="status-icon" aria-hidden="true">
                            {cameraTestResult === "ready"
                              ? "✔"
                              : cameraTestResult === "not-ready"
                                ? "✕"
                                : "●"}
                          </span>
                          <span className="status-message">
                            {cameraTestResult === "ready"
                              ? "Your camera is ready"
                              : cameraTestResult === "not-ready"
                                ? "Check your camera"
                                : "Press Test camera to verify your video feed"}
                          </span>
                        </div>

                        <div className="settings-card-bottom">
                          <button
                            type="button"
                            onClick={handleCameraTest}
                            className={`test-mic-button ${cameraTestRunning ? "running" : ""}`}
                          >
                            {cameraTestRunning
                              ? "Checking…"
                              : cameraTestResult === "ready"
                                ? "Passed"
                                : cameraTestResult === "not-ready"
                                  ? "Try again"
                                  : "Test camera"}
                          </button>
                          <p className="status-text">{cameraTestMessage}</p>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {profileSection === "billing" && (
                  <section className="profile-panel">
                    <div className="panel-header">
                      <h2>Plan & Billing</h2>
                      <p>
                        Manage your plan, payment details, and subscription
                        status.
                      </p>
                    </div>
                    <div className="billing-card">
                      <div className="billing-row">
                        <span>Current plan</span>
                        <strong>{planLevel}</strong>
                      </div>
                      <div className="billing-row">
                        <span>Next billing date</span>
                        <strong>July 31, 2026</strong>
                      </div>
                      <div className="billing-row">
                        <span>Payment method</span>
                        <strong>Visa •••• 4242</strong>
                      </div>
                      <div className="billing-actions">
                        <button type="button">Manage plan</button>
                        <button type="button" className="ghost-button">
                          Update payment
                        </button>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </section>
        ) : isCreateHuddleRoute ? (
          <section className="huddle-details-page">
            {generatedHuddle && !editHuddleLink ? (
              <div className="huddle-ready-card">
                <p className="eyebrow">Meet generated</p>
                <h2>Your meet is ready</h2>
                <p>
                  Copy and paste this Meet ID into the session field on the home
                  page.
                </p>
                <label>
                  Meet ID
                  <div className="meet-id-row">
                    <input readOnly value={generatedHuddle.link} />
                    <button type="button" onClick={handleCopyMeetId}>
                      Copy
                    </button>
                  </div>
                </label>
                <div className="form-actions">
                  <button type="button" onClick={() => navigate("/")}>
                    Back to home
                  </button>
                </div>
              </div>
            ) : (
              <form className="huddle-form" onSubmit={handleCreateHuddle}>
                <div>
                  <p className="eyebrow">
                    {huddle ? "Edit huddle" : "New huddle"}
                  </p>
                  <h2>{huddle ? "Update huddle details" : "Create Huddle"}</h2>
                  <p>
                    Set the details before generating a private huddle link.
                  </p>
                </div>
                <div
                  className="huddle-mode-selector"
                  role="group"
                  aria-label="Huddle type"
                >
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Instant
                    </Typography>
                    <Switch
                      checked={huddleMode === "scheduled"}
                      onChange={(event) =>
                        setHuddleMode(
                          event.target.checked ? "scheduled" : "instant",
                        )
                      }
                      color="secondary"
                    />
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Scheduled
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={1.2} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Private meeting
                    </Typography>
                    <Switch
                      checked={!!huddleForm.isPrivate}
                      onChange={(event) =>
                        setHuddleForm({
                          ...huddleForm,
                          isPrivate: event.target.checked,
                        })
                      }
                      color="secondary"
                    />
                  </Stack>
                </div>
                <label>
                  Team name
                  <input
                    required
                    type="text"
                    placeholder="Team or project name"
                    value={huddleForm.title}
                    onChange={(event) =>
                      setHuddleForm({
                        ...huddleForm,
                        title: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Purpose
                  <textarea
                    required
                    rows={4}
                    placeholder="Describe the meeting goal, agenda, or what you want to cover"
                    value={huddleForm.purpose}
                    onChange={(event) =>
                      setHuddleForm({
                        ...huddleForm,
                        purpose: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Hosting email
                  <input
                    required
                    type="email"
                    value={huddleForm.hostEmail}
                    onChange={(event) =>
                      setHuddleForm({
                        ...huddleForm,
                        hostEmail: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="form-row">
                  {huddleMode === "scheduled" ? (
                    <label>
                      Date and time
                      <input
                        required
                        type="datetime-local"
                        value={huddleForm.scheduledAt}
                        onChange={(event) =>
                          setHuddleForm({
                            ...huddleForm,
                            scheduledAt: event.target.value,
                          })
                        }
                      />
                    </label>
                  ) : null}
                  <label>
                    Duration (minutes)
                    <input
                      required
                      min="1"
                      type="number"
                      value={huddleForm.duration}
                      onChange={(event) =>
                        setHuddleForm({
                          ...huddleForm,
                          duration: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="form-actions">
                  <button type="button" onClick={() => navigate("/")}>
                    Cancel
                  </button>
                  <button type="submit">
                    {huddle
                      ? "Update"
                      : huddleMode === "instant"
                        ? "Generate instant link"
                        : "Generate scheduled link"}
                  </button>
                </div>
              </form>
            )}
          </section>
        ) : (
          <section className="hero-panel">
            <div className="hero-copy">
              <h2>Production-grade meetings with AI collaboration built in</h2>
              <p>
                Create a room, invite participants, and enjoy seamless WebRTC
                conferencing with shared intelligence.
              </p>
              {user ? (
                <>
                  {/* 1. Hero Actions / Join Form (Top) */}
                  <form
                    className="hero-actions"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleJoinHuddle();
                    }}
                  >
                    <input
                      value={roomId}
                      onChange={(e) => {
                        setRoomId(e.target.value);
                        setJoinError("");
                      }}
                      placeholder="Enter Huddle ID"
                    />
                    <button type="submit">Join Huddle</button>
                  </form>

                  {/* 2. Status and Error Messages */}
                  {joinError ? <p className="join-error">{joinError}</p> : null}
                  {joinApprovalPending ? (
                    <div
                      className="join-approval-status"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <CircularProgress size={18} color="inherit" />
                      <p className="join-error" style={{ margin: 0 }}>
                        {joinApprovalMessage || "Waiting for host approval..."}
                      </p>
                    </div>
                  ) : joinAcceptedPending ? (
                    <div
                      className="join-approval-status"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginTop: 8,
                      }}
                    >
                      <div className="join-status-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                      <p className="join-error" style={{ margin: 0 }}>
                        {joinApprovalMessage || "Joining meeting..."}
                      </p>
                    </div>
                  ) : null}
                  {joinApprovalMessage && !joinApprovalPending ? (
                    <p className="join-error">{joinApprovalMessage}</p>
                  ) : null}

                  {/* 3. Create Huddle Menu (Placed at the Last) */}
                  <div
                    className="create-huddle-menu"
                    ref={createMenuRef}
                    style={{ marginTop: 16 }}
                    onMouseEnter={() => {
                      if (!menuSticky) setShowCreateMenu(true);
                    }}
                    onMouseLeave={() => {
                      if (!menuSticky) setShowCreateMenu(false);
                    }}
                  >
                    <button
                      className="create-huddle-button"
                      aria-expanded={showCreateMenu}
                      aria-haspopup="menu"
                      onClick={(event) => {
                        event.preventDefault();
                        if (!showCreateMenu) {
                          setShowCreateMenu(true);
                          setMenuSticky(true);
                        } else if (showCreateMenu && !menuSticky) {
                          setMenuSticky(true);
                        } else {
                          setShowCreateMenu(false);
                          setMenuSticky(false);
                        }
                      }}
                    >
                      Create Huddle <span aria-hidden="true">▾</span>
                    </button>
                    {showCreateMenu ? (
                      <div className="create-huddle-options" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openCreateHuddle("instant")}
                        >
                          <strong>Instant</strong>
                          <span>Start a huddle now</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openCreateHuddle("scheduled")}
                        >
                          <strong>Schedule</strong>
                          <span>Choose a date and time</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="hero-actions sign-in-actions">
                  {isGoogleConfigured ? (
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={() => {
                        console.error("Login Failed");
                        handleGuestContinue();
                      }}
                    />
                  ) : null}
                  <button onClick={handleGuestContinue}>
                    Continue as Guest
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AppShell />} />
        <Route path="/meeting/*" element={<AppShell />} />
        <Route path="/create-huddle/*" element={<AppShell />} />
        <Route path="/profile/*" element={<AppShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
