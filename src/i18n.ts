import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      "app": {
        "title": "VerifiedVote",
        "description": "Secure remote voting authorization platform"
      },
      "auth": {
        "verifyVoter": "Verify Voter ID",
        "voterIdLabel": "Voter ID"
      },
      "ballot": {
        "submitVote": "Submit Vote"
      },
      "errors": {
        "invalidVoterId": "Invalid Voter ID format. Expected 1 letter + 7 alphanumeric."
      }
    }
  },
  hi: {
    translation: {
      "app": {
        "title": "वेरिफाईडवोट",
        "description": "सुरक्षित रिमोट वोटिंग प्राधिकरण मंच"
      },
      "auth": {
        "verifyVoter": "वोटर आईडी सत्यापित करें",
        "voterIdLabel": "वोटर आईडी"
      },
      "ballot": {
        "submitVote": "वोट सबमिट करें"
      },
      "errors": {
        "invalidVoterId": "अमान्य वोटर आईडी। 1 अक्षर + 7 अल्फ़ान्यूमेरिक अपेक्षित है।"
      }
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
