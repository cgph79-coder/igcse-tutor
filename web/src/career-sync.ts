/**
 * Keeps the Dispatches career on this device and on the Worker. The device copy works offline;
 * every sync sends it and gets back the Worker's merged copy (grades only go up, so merging never
 * loses progress). Only progress is stored: grades, run counts, dates and last scores.
 */
import { cleanCareer, emptyCareer, mergeCareers, type Career } from "../../shared/career";
import { ApiError, postCareer } from "./api";
import { prefs } from "./storage";

const KEY = "career:v1";

export function loadCareer(): Career {
  try {
    return cleanCareer(JSON.parse(prefs.get(KEY) ?? "null")) ?? emptyCareer();
  } catch {
    return emptyCareer();
  }
}

export function saveCareer(c: Career) {
  prefs.set(KEY, JSON.stringify(c));
}

/**
 * Send the device copy and keep the merged result. Offline or a server problem just leaves the
 * device copy as it is; it's sent again next time. Throws only when the login has expired.
 */
export async function syncCareer(token: string): Promise<Career> {
  const local = loadCareer();
  try {
    const merged = mergeCareers(local, cleanCareer(await postCareer(token, local)));
    saveCareer(merged);
    return merged;
  } catch (ex) {
    if (ex instanceof ApiError && ex.status === 401) throw ex;
    return local;
  }
}
