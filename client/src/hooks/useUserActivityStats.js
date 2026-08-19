import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

/**
 * Custom hook to fetch and manage real-time user activity stats
 * Provides: huddlesHosted, huddlesJoined, totalAttendees, pastMeetings
 * Includes automatic polling for real-time updates
 */
export const useUserActivityStats = (userId, userToken) => {
  const [stats, setStats] = useState({
    huddlesHosted: 0,
    huddlesJoined: 0,
    totalAttendees: 0,
  });
  const [pastMeetings, setPastMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const pollingIntervalRef = useRef(null);
  const isMountedRef = useRef(true);

  const fetchStats = useCallback(async () => {
    // Debug logging
    console.log("[useUserActivityStats] Fetching with:", { userId, hasToken: !!userToken, apiUrl: API_BASE_URL });

    if (!userId || !userToken) {
      console.log("[useUserActivityStats] Skipping fetch - missing userId or token");
      if (isMountedRef.current) {
        setLoading(false);
        setError("Missing user ID or authentication token");
      }
      return;
    }

    try {
      const headers = {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      };

      console.log("[useUserActivityStats] Making API calls to:", `${API_BASE_URL}/api/user/${userId}/stats`);

      // Fetch stats
      const statsResponse = await axios.get(
        `${API_BASE_URL}/api/user/${userId}/stats`,
        { headers }
      );

      console.log("[useUserActivityStats] Stats response:", statsResponse.data);

      // Fetch past meetings
      const meetingsResponse = await axios.get(
        `${API_BASE_URL}/api/user/${userId}/pastMeetings`,
        { headers }
      );

      console.log("[useUserActivityStats] Meetings response:", meetingsResponse.data);

      if (isMountedRef.current) {
        setStats(statsResponse.data);
        setPastMeetings(meetingsResponse.data.pastMeetings || []);
        setError(null);
        setLastUpdated(new Date());
        setLoading(false);
      }
    } catch (err) {
      console.error("[useUserActivityStats] Error:", {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
        url: err.config?.url,
        headers: err.config?.headers,
      });

      if (isMountedRef.current) {
        let errorMessage = "Failed to fetch stats";
        if (err.response?.status === 401) {
          errorMessage = "Session expired - Please sign in again";
        } else if (err.response?.status === 403) {
          errorMessage = "Invalid authentication token - Please sign in again";
        } else if (err.response?.status === 404) {
          errorMessage = "User data not found - Please contact support";
        } else if (err.response?.data?.error) {
          errorMessage = err.response.data.error;
        } else if (err.message) {
          errorMessage = err.message;
        }
        setError(errorMessage);
        setLoading(false);
      }
    }
  }, [userId, userToken]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchStats();
  }, [fetchStats]);

  // Set up polling for real-time updates (every 30 seconds)
  useEffect(() => {
    if (userId && userToken) {
      pollingIntervalRef.current = setInterval(() => {
        fetchStats();
      }, 30000);
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [userId, userToken, fetchStats]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Manual refetch function
  const refetch = useCallback(() => {
    setLoading(true);
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    pastMeetings,
    loading,
    error,
    lastUpdated,
    refetch,
  };
};
