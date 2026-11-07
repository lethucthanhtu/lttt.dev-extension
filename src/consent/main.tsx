import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Consent from './Consent';
import '../tailwind.css';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<Consent />
	</StrictMode>
);
