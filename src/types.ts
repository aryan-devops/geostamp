export type ImageRecord = {
  id: string;
  file: File;
  url: string;
  name: string;
  width: number;
  height: number;
  exifDate?: Date;
  exifLat?: number;
  exifLon?: number;
  crop: CropRect;
  cropOutput?: CropOutputSize;
  status: 'ready' | 'error';
  error?: string;
};

export type CropRect = { x: number; y: number; width: number; height: number };
export type CropOutputSize = { width: number; height: number };
export type Place = {
  name: string;
  locality?: string;
  district?: string;
  division?: string;
  state?: string;
  country?: string;
};
export type LocationValue = { lat: number; lon: number; place: Place };
export type AssignedValue = { timestamp: Date; lat: number; lon: number; isOriginalTime: boolean; isOriginalGps: boolean };
export type OverlaySettings = {
  showNetwork: boolean;
  showLocal: boolean;
  showCoordinates: boolean;
  showLocality: boolean;
  showDistrict: boolean;
  showState: boolean;
  fontSize: number;
  color: string;
  shadow: number;
  lineSpacing: number;
  margin: number;
  twelveHour: boolean;
};

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };
