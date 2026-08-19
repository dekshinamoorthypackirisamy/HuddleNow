# Real-Time Activity & History Integration Guide

## Overview

Your "Huddle Now" application now has real-time stats tracking and meeting history features connected to MongoDB. The Activity & History page automatically fetches and displays user data without page refresh.

## Architecture

### 1. Database Schema (MongoDB)

#### User Collection
```json
{
  "_id": ObjectId,
  "googleId": "string (unique)",
  "email": "string (required, unique, indexed)",
  "displayName": "string",
  "picture": "string (URL)",
  "roomId": "string",
  "createdAt": "Date (default: now)"
}
```

#### Huddle Collection
```json
{
  "_id": ObjectId,
  "link": "string (unique, required, indexed)",
  "title": "string (required)",
  "purpose": "string (required)",
  "hostEmail": "string (required, indexed)",
  "scheduledAt": "Date (required, indexed)",
  "duration": "number (minutes)",
  "ownerId": "string (indexed) - references User._id",
  "isPrivate": "boolean (default: false)",
  "createdAt": "Date (default: now)",
  "updatedAt": "Date (default: now)"
}
```

#### RoomParticipant Collection
```json
{
  "_id": ObjectId,
  "roomId": "string (required, indexed) - references Huddle.link",
  "socketId": "string (indexed)",
  "userId": "string (indexed) - references User._id",
  "displayName": "string",
  "email": "string",
  "avatar": "string (URL)",
  "role": "enum ['host', 'member'] (default: 'member')",
  "joinedAt": "Date (default: now)"
}
```

#### ActivityLog Collection
```json
{
  "_id": ObjectId,
  "roomId": "string (required, indexed)",
  "userId": "string (indexed)",
  "actionType": "string (required, indexed) - e.g., 'join', 'leave', 'create'",
  "changesData": "Mixed (any)",
  "createdAt": "Date (default: now, indexed)"
}
```

## API Endpoints

### Get User Activity Stats
**Endpoint:** `GET /api/user/:userId/stats`

**Authentication:** Required (Bearer token)

**Response:**
```json
{
  "huddlesHosted": 5,
  "huddlesJoined": 12,
  "totalAttendees": 45,
  "userId": "user-id-string"
}
```

**How it works:**
- Counts huddles where `ownerId === userId`
- Counts RoomParticipant entries where `userId` exists and `role === 'member'`
- Sums unique participants across all hosted huddles

---

### Get User's Past Meetings
**Endpoint:** `GET /api/user/:userId/pastMeetings?limit=20`

**Authentication:** Required (Bearer token)

**Query Parameters:**
- `limit` (optional, default: 20) - Maximum number of past meetings to return

**Response:**
```json
{
  "pastMeetings": [
    {
      "id": "huddle-id",
      "title": "Team Standup",
      "purpose": "Daily sync",
      "scheduledAt": "2026-08-16T10:00:00Z",
      "duration": 30,
      "participantCount": 8,
      "roomId": "room-link-string"
    }
  ]
}
```

**How it works:**
- Queries Huddle collection where `ownerId === userId` and `scheduledAt < now()`
- Sorts by `scheduledAt` descending (most recent first)
- For each huddle, counts participants from RoomParticipant collection
- Limits results to specified number

## React Hook: `useUserActivityStats`

### Location
`client/src/hooks/useUserActivityStats.js`

### Usage

```jsx
import { useUserActivityStats } from "./hooks/useUserActivityStats";

function MyComponent() {
  const { stats, pastMeetings, loading, error, lastUpdated, refetch } = 
    useUserActivityStats(userId, userToken);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <div>
      <p>Hosted: {stats.huddlesHosted}</p>
      <p>Joined: {stats.huddlesJoined}</p>
      <p>Total Attendees: {stats.totalAttendees}</p>
      
      <button onClick={refetch}>Refresh Stats</button>
      
      {pastMeetings.map(meeting => (
        <div key={meeting.id}>
          <h4>{meeting.title}</h4>
          <p>Date: {new Date(meeting.scheduledAt).toLocaleDateString()}</p>
          <p>Participants: {meeting.participantCount}</p>
        </div>
      ))}
    </div>
  );
}
```

### Hook API

#### Parameters
- `userId` (string | null) - The user's unique ID
- `userToken` (string | null) - JWT auth token

#### Return Object
```typescript
{
  stats: {
    huddlesHosted: number,
    huddlesJoined: number,
    totalAttendees: number
  },
  pastMeetings: Array<{
    id: string,
    title: string,
    purpose: string,
    scheduledAt: string (ISO date),
    duration: number,
    participantCount: number,
    roomId: string
  }>,
  loading: boolean,
  error: string | null,
  lastUpdated: Date | null,
  refetch: () => Promise<void>
}
```

### Features

✅ **Real-time polling** - Auto-refreshes every 30 seconds
✅ **Loading states** - Skeleton UI while fetching
✅ **Error handling** - Graceful error display
✅ **Manual refresh** - `refetch()` function for on-demand updates
✅ **Memory cleanup** - Proper cleanup on unmount
✅ **Double-click prevention** - Won't fire requests unnecessarily

## Implementation in Activity Component

The Activity & History page (`profileSection === "activity"`) now includes:

### 1. **Loading State**
```jsx
{loading && (
  <div>
    <CircularProgress size={32} />
    <p>Loading meeting history...</p>
  </div>
)}
```

### 2. **Error State**
```jsx
{error && (
  <div style={{ color: "#ff6b6b" }}>
    Error loading stats: {error}
  </div>
)}
```

### 3. **Real Stats Display**
```jsx
<div className="activity-metrics">
  <div>
    <strong>{stats.huddlesHosted}</strong>
    <span>Huddles hosted</span>
  </div>
  {/* ... more metrics ... */}
</div>
```

### 4. **Past Meetings List**
```jsx
{pastMeetings.map(meet => (
  <article key={meet.id} className="upcoming-meet-card">
    <strong>{meet.title}</strong>
    <span>{new Date(meet.scheduledAt).toLocaleDateString()}</span>
    <p>{meet.purpose}</p>
    <div>Duration: {meet.duration}m • {meet.participantCount} participants</div>
  </article>
))}
```

### 5. **Refresh Button**
Manual refresh option to update stats on demand

### 6. **Last Updated Timestamp**
Shows when stats were last fetched

## Real-Time Behavior

The system updates in two ways:

### 1. **Automatic Polling**
- Every 30 seconds, the hook fetches latest stats
- Silent background refresh (no interruption)
- User sees `lastUpdated` timestamp change

### 2. **Manual Refresh**
- User clicks "Refresh" button
- Immediately re-fetches all stats
- Shows loading state during fetch

## Fallback & Error Handling

### When MongoDB is Down
- Server falls back to in-memory storage
- Stats still work (returns 0 values)
- Past meetings may be incomplete

### When API Request Fails
- Error message displayed to user
- Stats remain at last known values
- Retry with refresh button

### When User Not Authenticated
- Hook receives `null` userId/token
- Skips API calls gracefully
- No errors thrown

## Environment Variables Required

Add to `.env` if needed:
```
VITE_API_BASE_URL=http://localhost:3000
```

The hook automatically uses this URL for API calls.

## Database Indexing Strategy

For optimal performance, ensure these indexes exist:

```javascript
// User collection
db.users.createIndex({ email: 1 }, { unique: true })
db.users.createIndex({ googleId: 1 }, { sparse: true, unique: true })

// Huddle collection
db.huddles.createIndex({ link: 1 }, { unique: true })
db.huddles.createIndex({ ownerId: 1 })
db.huddles.createIndex({ scheduledAt: 1 })
db.huddles.createIndex({ hostEmail: 1 })

// RoomParticipant collection
db.roomparticipants.createIndex({ roomId: 1 })
db.roomparticipants.createIndex({ userId: 1 })
db.roomparticipants.createIndex({ socketId: 1 })

// ActivityLog collection
db.activitylogs.createIndex({ roomId: 1 })
db.activitylogs.createIndex({ userId: 1 })
db.activitylogs.createIndex({ actionType: 1 })
db.activitylogs.createIndex({ createdAt: 1 })
```

## Testing the Integration

1. **Sign in** with your Google account
2. **Navigate** to Profile → Activity & History
3. **Verify:**
   - Stats load (or show loading state)
   - Past meetings display with details
   - Refresh button works
   - Stats update every 30 seconds (watch `lastUpdated` time)

4. **Create a huddle** and observe:
   - "Huddles hosted" count increases
   - New meeting appears in "Past meetings" after it ends

5. **Join other huddles** and see:
   - "Huddles joined" count increases
   - Total attendees reflects participants

## Performance Considerations

- **Polling interval**: 30 seconds (adjustable in hook)
- **Database queries**: Indexed for fast retrieval
- **API response**: Limits past meetings to last 20 (configurable)
- **Frontend rendering**: Virtual scrolling recommended for 100+ meetings

## Future Enhancements

1. **WebSocket real-time updates** instead of polling
2. **Graphical charts** for activity over time
3. **Export meeting history** as CSV/PDF
4. **Advanced filtering** by date range, participant count, etc.
5. **Meeting recording stats** (if recording feature added)
6. **Attendee insights** - who attended which meetings

## Troubleshooting

### Stats show as 0
- Check that `ownerId` is set when huddles are created
- Verify user is authenticated with token
- Check browser console for API errors

### "Past meetings recorded yet" always shows
- Ensure past meetings have `scheduledAt` in the past
- Check RoomParticipant entries exist for meetings
- Verify MongoDB connection with `/api/db-status`

### Real-time updates not working
- Check polling interval (30 seconds) - may appear delayed
- Click refresh button to force update
- Verify user token hasn't expired
- Check browser DevTools → Network tab for API calls

### Error: "Failed to fetch stats"
- Verify `/api/user/:userId/stats` endpoint is accessible
- Check authentication token validity
- Review server error logs
- Ensure MongoDB is connected

---

**Last Updated:** August 16, 2026
**Status:** ✅ Production Ready
