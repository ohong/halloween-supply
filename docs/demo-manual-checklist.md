# Demo checks to run on your devices

Use https://halloween.supply. Stripe must display **Test mode** or **Sandbox**. Use only test payment details.

The checks below cover physical devices, human judgment, and operating-system behavior that this agent cannot establish. Server checks and synthetic media do not establish these results. Run camera and voice checks before permission-failure checks.

## 1. Screenshot sourcing with your actual demo image

1. Open https://halloween.supply/screenshot.
2. Upload the exact screenshot you plan to show. Use one clear, mostly full-body subject.
3. Confirm the character, garment types, main colors, silhouettes, and adult sizing match your reference. For the two supplied film stills, both titles should identify Ryland Grace from Project Hail Mary.
4. Open each merchant link. Check that its selected color and product image agree with the result.
5. Confirm the fox cardigan is a finished sweater, not a yarn kit. Confirm the spacecraft look has clear glasses and an orange strap harness, with no steampunk goggles or invented wig. Read the match notes for differences.
6. Upload the same file again. Confirm image analysis, Firecrawl searches and merchant verification run again; a previous result must not replay.
7. Choose offered sizes, add the look, and open the cart. Confirm pieces and prices agree. Upload a different screenshot and add it; confirm products from the old screenshot leave the cart.

Also try paste from your actual screenshot tool and drag-and-drop from Finder. Clipboard formats and phone image decoders differ. Automated samples cannot establish match quality for an unseen screenshot. Search can still return partial results or hit provider limits. Every upload runs fresh analysis and sourcing. Provider limits and merchant response times can make a repeat slower, too.

## 2. Physical camera and microphone

1. Open [Cosmic Cowboy](https://halloween.supply/costumes/cosmic-cowboy) on the phone/browser used for the demo.
2. Open the **Try it on** tab, then select **Try it on live**.
3. Read and accept the camera/microphone disclosure, then select **Start my mirror**.
4. Allow camera and microphone access. Confirm the inset shows you and the main view shows moving generated video.
5. Move your arms, turn sideways, and move closer. Check face stability, hands, garment visibility, and acceptable delay.
6. Repeat the appearance check under the actual venue lighting and network.

Human movement, clothing occlusion, physical device permissions, real microphone quality, echo, and venue connectivity remain manual checks. A moving frame does not prove the requested garment rendered correctly.

## 3. GPT-Live voice commands and look switching

Use the same live session to avoid extra starts.

1. Say **“Keep the hat. Choose the cheapest jacket.”** Confirm the hat stays selected and only the jacket changes.
2. Say **“I already own the boots.”** Confirm the boots become owned and leave the shopping subtotal.
3. Say **“Undo that.”** Confirm the previous state returns.
4. Say **“Try Velvet Vampire.”**, then **“Choose the cheapest cape.”** Confirm the new catalog controls the reply.
5. Switch through Moon Moth, Linen Ghost, and Woodland Mushroom using the arrows or phone swipe. Confirm each look changes without restarting video.
6. Try a normal interruption and your natural accent. Confirm the assistant hears the correction and does not repeat an old selection.
7. Select **Shop this look**. Confirm the correct costume page, selected products, and owned/skipped choices carry over.

Speech recognition with your voice, turn-taking, speaker volume, Bluetooth routing, and speech-to-visible-garment delay need your assessment.

## 4. Media controls and cleanup

1. Start one live session. Mute the microphone and confirm voice input stops.
2. Freeze the preview. Confirm generated video stops while voice remains available. With a paired phone, its raw camera preview stays connected; use Disconnect phone to stop that camera.
3. Resume once. Confirm moving video returns.
4. Save a preview. Confirm a useful file opens on your device.
5. Close the mirror. Confirm camera and microphone indicators turn off.
6. In a separate run, hide the tab or lock the phone. Confirm media stops. Return and restart explicitly.
7. Let a session reach three minutes. Confirm it stops instead of continuing indefinitely.

Starting or resuming live previews consumes provider credits even though checkout remains in Stripe test mode. Repeated sessions have no hourly app or project firewall quota. See [current session behavior](./mirror-session-limits.md).

## 5. Phone photo and desktop QR handoff

1. Put the phone and desktop on the same Wi-Fi. Open a costume’s **Try it on** tab and select **Use phone camera**.
2. Scan the QR code with your phone. Confirm it opens the production capture page.
3. On the phone, choose whether to share its microphone, then select **Open camera**. Keep both tabs visible.
4. Confirm the desktop shows moving phone video. Select **Take photo from phone**, and confirm a clear photo arrives without refresh.
5. Take another photo from each device. Confirm the replacement is used. Test **Try it on** and **Try it on live** with that connection.
6. Stop sharing or select **Disconnect phone**. Confirm the phone camera indicator turns off. Reconnect once with a new code.

Physical scanning, camera quality, permissions, rotation and real two-device Wi-Fi connectivity remain manual checks. Pairing expires after ten minutes. Direct WebRTC requires both tabs to remain visible; guest-network isolation and different networks can prevent connection. Old single-photo QR codes no longer work. See [phone camera details](./phone-camera.md).

## 6. Personal photo try-on and sharing

1. In the **Try it on** tab, upload or capture a full-body photo with one person.
2. Select **Try it on** after reading the OpenAI disclosure.
3. Compare the result with your face, body, and selected products. Check garment coverage and identity.
4. Select **Show original**, then **Show preview**. Confirm both images are correct.
5. Change one product and generate again. Confirm the changed product appears and the previous result is not treated as current.
6. Save the image. Try **Share** and confirm the native share sheet works on your phone.
7. Remove the photo. Confirm the personal preview disappears.

Personal likeness, visual fit, skin/body rendering, and native sharing need human review. Generated previews cannot prove physical fit.

## 7. Personal 3D result on a phone

1. Complete a photo try-on, then select **Create my 3D model** beneath its result.
2. Wait for the model. Rotate and pinch to zoom on the actual demo phone.
3. Select each listed piece. Confirm its focus view is useful.
4. Switch between **Photo** and **3D look**, then reset the camera.
5. Check face, hair, textures, the back of the model, and acceptable frame rate.
6. Download the model and confirm the file opens in your intended viewer.

Mobile GPU stability, touch gestures, personal likeness, unseen surfaces, and native GLB viewing remain manual checks. Generation costs provider credits. Focus regions are approximate, not exact garment outlines.

## 8. Five-costume checkout rehearsal

Repeat for [Cosmic Cowboy](https://halloween.supply/costumes/cosmic-cowboy), [Velvet Vampire](https://halloween.supply/costumes/velvet-vampire), [Moon Moth](https://halloween.supply/costumes/moon-moth), [Linen Ghost](https://halloween.supply/costumes/linen-ghost), and [Woodland Mushroom](https://halloween.supply/costumes/woodland-mushroom).

1. Change one product, select **Add costume to cart**, and open the cart.
2. Confirm the cart has the intended products and merchant subtotal. Missing sizes use clearly labeled Medium demo defaults.
3. Optionally tell the assistant actual sizes. Confirm explicit sizes replace the defaults.
4. Select Checkout. Confirm Stripe displays **Test mode** or **Sandbox**, correct lines, and no added tax or shipping.
5. Use `4242 4242 4242 4242`, any future expiry, any three-digit CVC, and a test US address.
6. Complete the test payment. Confirm the success page and cleared cart.
7. Repeat once using Stripe's back/cancel control. Confirm the cart survives cancellation.

Checkout APIs are testable by the agent. Rehearsing the exact phone browser, keyboard, address form, back navigation, and presentation is still useful. Apple Pay, Google Pay, Link login, real cards, merchant purchases, emails, tracking, and fulfillment are outside this test.

## 9. Permission and connection failures

1. After the main rehearsal, deny camera or microphone permission. Confirm a useful error appears and the page remains usable.
2. Restore the permission using your browser controls, then retry explicitly.
3. Briefly interrupt Wi-Fi during a preview. Confirm the UI reports failure and does not silently buy or restart a paid session.
4. Rotate the phone and use its Back control. Confirm no hidden media continues.

These depend on operating-system prompts and the physical network. They cannot be proved with route validation or synthetic media.

## 10. Your gallery search and saved looks

1. On the home page, enter the exact character or mood you plan to use in the demo.
2. Confirm the ranked costumes make sense. Switch Male/Female and verify the reference images.
3. Save a costume, open **Saved**, and reload. Confirm it stays saved in that browser.
4. For an idea with no strong catalog match, use **Create** only if you plan to show custom creation.
5. Check the created look's merchant products against the intended character and adult wearer.

Semantic search and typed costume creation reached main during this task. Their integration is preserved. This pass does not establish quality for your unseen queries or a complete real-provider typed-creation run. Creation spends provider credits and can finish with explicitly missing pieces.

## Send back a failure

Record the device/browser, page, action, expected result, actual result, and approximate time. Include a screenshot or short recording when useful. Do not include keys or payment credentials.
